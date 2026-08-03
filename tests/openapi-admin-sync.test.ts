import { expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { GeneratorRegistryLive } from "../src/adapters/bun-generator-registry";
import { AdminGenerationError } from "../src/domain/errors";
import { AdminProcessRunner } from "../src/ports/admin-process-runner";
import {
	preflightAdminGeneratedFiles,
	writeAdminGeneratedFiles,
} from "../src/use-cases/openapi-admin-manifest";
import {
	runOpenApiAdminSync,
	syncAdminProject,
	type OpenApiAdminSyncDependencies,
} from "../src/use-cases/openapi-admin-sync";

interface State {
	resources: string[];
}

const dependencies = (
	options: {
		appliedFingerprint?: string | null;
		desiredFingerprint?: string;
		changes?: string[];
		conflicts?: string[];
		qualityIssues?: string[];
	} = {},
) => {
	const calls: string[] = [];
	const desired = {
		fingerprint: options.desiredFingerprint ?? "next",
		state: { resources: ["users"] },
	};
	const deps: OpenApiAdminSyncDependencies<State> = {
		loader: {
			load: async () => {
				calls.push("load");
				return desired;
			},
		},
		diff: {
			compare: async () => {
				calls.push("diff");
				return options.changes ?? [];
			},
		},
		conflicts: {
			detect: async () => {
				calls.push("conflicts");
				return options.conflicts ?? [];
			},
		},
		applier: {
			apply: async () => {
				calls.push("apply");
			},
		},
		quality: {
			check: async (_candidate, mode) => {
				calls.push(`quality:${mode}`);
				return options.qualityIssues ?? [];
			},
		},
		manifest: {
			loadApplied: async () => {
				calls.push("manifest:load");
				return {
					fingerprint:
						options.appliedFingerprint === undefined ? "current" : options.appliedFingerprint,
					state: { resources: [] },
				};
			},
			commitApplied: async () => {
				calls.push("manifest:commit");
			},
		},
	};
	return { calls, deps };
};

test("plan reports a deterministic preflight without mutation", async () => {
	const { calls, deps } = dependencies({
		changes: ["resource:users", "operation:list", "resource:users"],
		conflicts: ["z.ts", "a.ts", "z.ts"],
	});

	const result = await runOpenApiAdminSync("plan", deps);

	expect(result).toEqual({
		mode: "plan",
		status: "drift",
		drift: true,
		fingerprintChanged: true,
		applied: false,
		committed: false,
		appliedFingerprint: "current",
		desiredFingerprint: "next",
		changes: ["operation:list", "resource:users"],
		conflicts: ["a.ts", "z.ts"],
		qualityIssues: [],
	});
	expect(calls).not.toContain("apply");
	expect(calls).not.toContain("manifest:commit");
	expect(calls.some((call) => call.startsWith("quality:"))).toBe(false);
});

test("check returns clean or drift status and never applies or commits", async () => {
	const clean = dependencies({ appliedFingerprint: "same", desiredFingerprint: "same" });
	const drifted = dependencies({
		appliedFingerprint: "same",
		desiredFingerprint: "same",
		changes: ["schema:users"],
	});

	expect((await runOpenApiAdminSync("check", clean.deps)).status).toBe("clean");
	expect((await runOpenApiAdminSync("check", drifted.deps)).status).toBe("drift");
	for (const calls of [clean.calls, drifted.calls]) {
		expect(calls).toContain("quality:check");
		expect(calls).not.toContain("apply");
		expect(calls).not.toContain("manifest:commit");
	}
});

test("check reports read-only quality failures deterministically", async () => {
	const { deps } = dependencies({
		appliedFingerprint: "same",
		desiredFingerprint: "same",
		qualityIssues: ["typecheck", "lint", "lint"],
	});

	const result = await runOpenApiAdminSync("check", deps);

	expect(result.status).toBe("quality-failed");
	expect(result.drift).toBe(false);
	expect(result.qualityIssues).toEqual(["lint", "typecheck"]);
});

test("apply blocks on conflicts before mutation", async () => {
	const { calls, deps } = dependencies({ conflicts: ["src/custom.ts"] });

	const result = await runOpenApiAdminSync("apply", deps);

	expect(result.status).toBe("blocked");
	expect(result.applied).toBe(false);
	expect(calls).not.toContain("apply");
	expect(calls).not.toContain("quality:apply");
	expect(calls).not.toContain("manifest:commit");
});

test("apply blocks on normalized conflicts discovered by the applier", async () => {
	const { calls, deps } = dependencies({ changes: ["resource:users"] });
	deps.applier.apply = async () => {
		calls.push("apply");
		return ["z.ts", "a.ts", "z.ts"];
	};

	const result = await runOpenApiAdminSync("apply", deps);

	expect(result).toMatchObject({
		status: "blocked",
		applied: false,
		committed: false,
		conflicts: ["a.ts", "z.ts"],
	});
	expect(calls).not.toContain("quality:apply");
	expect(calls).not.toContain("manifest:commit");
});

test("apply blocks when a concrete manifest write discovers a late file conflict", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-race-"));
	const path = "generated.ts";
	const metadata = {
		framework: "nextjs" as const,
		packageManager: "bun" as const,
		specFingerprint: "current",
		adminPlanSnapshot: { resources: ["pets"] },
	};
	try {
		writeAdminGeneratedFiles(root, [{ path, content: "v1\n" }], metadata);
		expect(preflightAdminGeneratedFiles(root, [{ path, content: "v2\n" }]).conflicts).toEqual([]);
		writeFileSync(join(root, path), "late user edit\n");
		const { calls, deps } = dependencies({ changes: ["file written: generated.ts"] });
		deps.applier.apply = async () => {
			calls.push("apply");
			return writeAdminGeneratedFiles(
				root,
				[{ path, content: "v2\n" }],
				{
					...metadata,
					specFingerprint: "next",
					adminPlanSnapshot: { resources: ["owners"] },
				},
				{ deferAppliedFingerprint: true },
			).conflicts;
		};

		const result = await runOpenApiAdminSync("apply", deps);

		expect(result).toMatchObject({
			status: "blocked",
			applied: false,
			committed: false,
			conflicts: [path],
		});
		expect(calls).not.toContain("quality:apply");
		expect(calls).not.toContain("manifest:commit");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("apply commits the applied fingerprint only after quality succeeds", async () => {
	const { calls, deps } = dependencies({ changes: ["resource:users"] });

	const result = await runOpenApiAdminSync("apply", deps);

	expect(result).toMatchObject({
		status: "applied",
		applied: true,
		committed: true,
		appliedFingerprint: "next",
	});
	expect(calls.indexOf("apply")).toBeLessThan(calls.indexOf("quality:apply"));
	expect(calls.indexOf("quality:apply")).toBeLessThan(calls.indexOf("manifest:commit"));
});

test("apply leaves the applied fingerprint uncommitted when quality fails", async () => {
	const { calls, deps } = dependencies({ qualityIssues: ["build"] });

	const result = await runOpenApiAdminSync("apply", deps);

	expect(result).toMatchObject({
		status: "quality-failed",
		applied: true,
		committed: false,
		appliedFingerprint: "current",
		qualityIssues: ["build"],
	});
	expect(calls).toContain("apply");
	expect(calls).not.toContain("manifest:commit");
});

const fixture = join(import.meta.dir, "fixtures", "openapi-admin-pets.json");

const snapshotTree = (root: string): Record<string, string> => {
	const snapshot: Record<string, string> = {};
	const visit = (directory: string): void => {
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name);
			if (statSync(path).isDirectory()) visit(path);
			else snapshot[path.slice(root.length + 1)] = readFileSync(path, "utf8");
		}
	};
	visit(root);
	return snapshot;
};

test("concrete plan deterministically reports drift without creating the output", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-plan-"));
	const output = join(root, "pet-admin");
	try {
		const result = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "plan" }).pipe(
				Effect.provideService(AdminProcessRunner, {
					run: () => Effect.succeed({ stdout: "", stderr: "" }),
				}),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(result.status).toBe("drift");
		expect(result.changed).toBe(true);
		expect(result.diff).toEqual([...result.diff].sort((left, right) => left.localeCompare(right)));
		expect(result.diff.some((change) => change.startsWith("file written: "))).toBe(true);
		expect(result.qualityIssues).toEqual([]);
		expect(existsSync(output)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concrete plan validates and diffs the user-owned admin UI overlay", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-overlay-"));
	const output = join(root, "pet-admin");
	const runner = { run: () => Effect.succeed({ stdout: "", stderr: "" }) };
	try {
		await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const unchanged = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "plan" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		expect(unchanged.status).toBe("clean");
		expect(unchanged.diff).not.toContain("admin UI overlay changed");
		const overlayPath = join(output, ".fizzyx/admin-ui.yaml");
		writeFileSync(
			overlayPath,
			Bun.YAML.stringify({
				version: 1,
				resources: {
					pets: { label: "Pet Directory", group: "Catalog", icon: "package" },
				},
			}),
		);
		const before = readFileSync(overlayPath, "utf8");

		const result = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "plan" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(result.status).toBe("drift");
		expect(result.diff).toContain("admin UI overlay changed");
		expect(result.diff).toContain("navigation changed");
		expect(result.diff).toContain("resource pets property changed: label");
		expect(readFileSync(overlayPath, "utf8")).toBe(before);

		const applied = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const manifest = JSON.parse(
			readFileSync(join(output, ".fizzyx/admin-manifest.json"), "utf8"),
		) as {
			appliedOverlayFingerprint: string | null;
			pendingOverlayFingerprint: string | null;
			adminPlanSnapshot: { resources: Array<{ key: string; label: string }> };
		};
		expect(applied.status).toBe("applied");
		expect(manifest.appliedOverlayFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(manifest.pendingOverlayFingerprint).toBeNull();
		expect(manifest.adminPlanSnapshot.resources.find((item) => item.key === "pets")?.label).toBe(
			"Pet Directory",
		);
		expect(readFileSync(overlayPath, "utf8")).toBe(before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concrete apply leaves a pending fingerprint when targeted quality fails", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-quality-"));
	const output = join(root, "pet-admin");
	const runner = {
		run: (argv: string[]) =>
			Effect.fail(new AdminGenerationError({ message: "quality failed", command: argv })),
	};
	try {
		const result = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const manifest = JSON.parse(
			readFileSync(join(output, ".fizzyx/admin-manifest.json"), "utf8"),
		) as {
			appliedSpecFingerprint: string | null;
			pendingSpecFingerprint: string | null;
			adminPlanSnapshot: unknown;
		};

		expect(result.status).toBe("quality-failed");
		expect(result.qualityIssues).toEqual(["quality failed"]);
		expect(manifest.appliedSpecFingerprint).toBeNull();
		expect(manifest.pendingSpecFingerprint).toBeString();
		expect(manifest.adminPlanSnapshot).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("quality mutations refresh base hashes even when a later command fails", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-quality-mutation-"));
	const output = join(root, "pet-admin");
	const changedFixture = join(root, "changed-openapi.json");
	const successfulRunner = { run: () => Effect.succeed({ stdout: "", stderr: "" }) };
	try {
		await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, successfulRunner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const oldManifest = JSON.parse(
			readFileSync(join(output, ".fizzyx/admin-manifest.json"), "utf8"),
		) as { appliedSpecFingerprint: string; adminPlanSnapshot: unknown };
		const spec = JSON.parse(readFileSync(fixture, "utf8")) as { paths: Record<string, unknown> };
		spec.paths["/owners"] = {
			get: { operationId: "listOwners", responses: { "200": { description: "ok" } } },
		};
		writeFileSync(changedFixture, JSON.stringify(spec));
		let command = 0;
		const result = await Effect.runPromise(
			syncAdminProject({
				input: changedFixture,
				output,
				framework: "nextjs",
				mode: "apply",
			}).pipe(
				Effect.provideService(AdminProcessRunner, {
					run: (argv) => {
						command += 1;
						if (command === 1) {
							const formattedPath = join(output, argv[2]!);
							writeFileSync(formattedPath, `${readFileSync(formattedPath, "utf8")}\n`);
							return Effect.succeed({ stdout: "", stderr: "" });
						}
						return Effect.fail(new AdminGenerationError({ message: "lint failed", command: argv }));
					},
				}),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const pendingManifest = JSON.parse(
			readFileSync(join(output, ".fizzyx/admin-manifest.json"), "utf8"),
		) as {
			appliedSpecFingerprint: string;
			pendingSpecFingerprint: string;
			adminPlanSnapshot: unknown;
		};

		expect(result.status).toBe("quality-failed");
		expect(pendingManifest.appliedSpecFingerprint).toBe(oldManifest.appliedSpecFingerprint);
		expect(pendingManifest.pendingSpecFingerprint).toBeString();
		expect(pendingManifest.adminPlanSnapshot).toEqual(oldManifest.adminPlanSnapshot);

		const retry = await Effect.runPromise(
			syncAdminProject({
				input: changedFixture,
				output,
				framework: "nextjs",
				mode: "plan",
			}).pipe(
				Effect.provideService(AdminProcessRunner, successfulRunner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		expect(retry.conflicts).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concrete plan preserves coordinator status when file conflicts are present", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-conflict-"));
	const output = join(root, "pet-admin");
	const runner = { run: () => Effect.succeed({ stdout: "", stderr: "" }) };
	try {
		await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const conflictPath = join(output, "app/(admin)/page.tsx");
		writeFileSync(conflictPath, `${readFileSync(conflictPath, "utf8")}\n// local change\n`);

		const result = await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "plan" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(result).toMatchObject({
			status: "drift",
			changed: true,
			conflicts: ["app/(admin)/page.tsx"],
			qualityIssues: [],
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("concrete check runs the project check command without changing generated output", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-sync-check-"));
	const output = join(root, "pet-admin");
	const changedFixture = join(root, "changed-openapi.json");
	const successfulRunner = {
		run: () => Effect.succeed({ stdout: "", stderr: "" }),
	};
	try {
		await Effect.runPromise(
			syncAdminProject({ input: fixture, output, framework: "nextjs", mode: "apply" }).pipe(
				Effect.provideService(AdminProcessRunner, successfulRunner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		const spec = JSON.parse(readFileSync(fixture, "utf8")) as {
			paths: Record<string, unknown>;
		};
		spec.paths["/owners"] = {
			get: { operationId: "listOwners", responses: { "200": { description: "ok" } } },
		};
		writeFileSync(changedFixture, JSON.stringify(spec));
		const before = snapshotTree(output);
		const commands: string[][] = [];
		const result = await Effect.runPromise(
			syncAdminProject({
				input: changedFixture,
				output,
				framework: "nextjs",
				mode: "check",
			}).pipe(
				Effect.provideService(AdminProcessRunner, {
					run: (argv) => {
						commands.push([...argv]);
						return Effect.fail(
							new AdminGenerationError({ message: "project check failed", command: argv }),
						);
					},
				}),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(commands).toEqual([["bun", "run", "check"]]);
		expect(result).toMatchObject({
			status: "quality-failed",
			changed: true,
			qualityIssues: ["project check failed"],
		});
		expect(result.diff.length).toBeGreaterThan(0);
		expect(snapshotTree(output)).toEqual(before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
