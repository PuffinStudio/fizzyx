import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import { AdminGenerationError } from "../src/domain/errors";
import { GeneratorRegistryLive } from "../src/adapters/bun-generator-registry";
import { AdminProcessRunner } from "../src/ports/admin-process-runner";
import { generateAdminProject } from "../src/use-cases/openapi-admin-service";

const fixture = join(import.meta.dir, "fixtures", "openapi-admin-pets.json");

test("falls back from a known Bun compatibility failure to pnpm without selecting npm", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-fallback-"));
	const output = join(root, "pet-admin");
	const commands: string[][] = [];
	let rejectedBun = false;
	const runner = {
		run: (argv: string[]) => {
			commands.push(argv);
			if (!rejectedBun && argv[0] === "bunx" && argv.includes("init")) {
				rejectedBun = true;
				return Effect.fail(
					new AdminGenerationError({
						message: "bun scaffold failed",
						command: argv,
						stderr: "Bun is not supported by this CLI version",
					}),
				);
			}
			if (argv[0] === "pnpm" && argv.includes("init")) {
				mkdirSync(output, { recursive: true });
				writeFileSync(
					join(output, "package.json"),
					JSON.stringify({ scripts: { build: "next build" } }),
				);
			}
			return Effect.succeed({ stdout: "", stderr: "" });
		},
	};

	try {
		const result = await Effect.runPromise(
			generateAdminProject({ input: fixture, output, framework: "nextjs" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(result.packageManager).toBe("pnpm");
		expect(commands.some((argv) => argv[0] === "pnpm")).toBe(true);
		expect(commands.flat().join(" ")).not.toMatch(/\bnpm\b|\bnpx\b/);

		commands.length = 0;
		const regenerated = await Effect.runPromise(
			generateAdminProject({ input: fixture, output, framework: "nextjs" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		expect(regenerated.packageManager).toBe("pnpm");
		expect(commands.some((argv) => argv.slice(0, 3).join(" ") === "pnpm exec oxfmt")).toBe(true);
		expect(commands.flat()).not.toContain(".");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("surfaces an unknown scaffold failure without an unsafe fallback", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-failure-"));
	const output = join(root, "pet-admin");
	const commands: string[][] = [];
	const runner = {
		run: (argv: string[]) => {
			commands.push(argv);
			return Effect.fail(
				new AdminGenerationError({
					message: "framework scaffold failed",
					command: argv,
					stderr: "network unavailable",
				}),
			);
		},
	};

	try {
		await expect(
			Effect.runPromise(
				generateAdminProject({ input: fixture, output, framework: "nextjs" }).pipe(
					Effect.provideService(AdminProcessRunner, runner),
					Effect.provide(GeneratorRegistryLive),
				),
			),
		).rejects.toMatchObject({ message: "framework scaffold failed" });
		expect(commands).toHaveLength(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaces and owns the official scaffold welcome route on first generation", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-welcome-"));
	const output = join(root, "pet-admin");
	const runner = {
		run: (argv: string[]) => {
			if (argv[0] === "bunx" && argv.includes("shadcn@latest") && argv.includes("init")) {
				mkdirSync(join(output, "app"), { recursive: true });
				writeFileSync(
					join(output, "package.json"),
					JSON.stringify({ scripts: { build: "next build" } }),
				);
				writeFileSync(join(output, "app/page.tsx"), "export default function Welcome() {}\n");
				writeFileSync(join(output, "app/layout.tsx"), 'import { Geist } from "next/font/google"\n');
				writeFileSync(join(output, "app/globals.css"), '@import "tailwindcss";\n');
			}
			return Effect.succeed({ stdout: "", stderr: "" });
		},
	};

	try {
		const result = await Effect.runPromise(
			generateAdminProject({
				input: fixture,
				output,
				framework: "nextjs",
				shadcnArgs: ["--preset", "forwardedPreset"],
			}).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);

		expect(result.conflicts).not.toContain("app/(admin)/page.tsx");
		expect(existsSync(join(output, "app/page.tsx"))).toBe(false);
		expect(readFileSync(join(output, "app/(admin)/page.tsx"), "utf8")).toContain("AdminDashboard");
		expect(readFileSync(join(output, "app/layout.tsx"), "utf8")).not.toContain("next/font");
		expect(readFileSync(join(output, "app/globals.css"), "utf8")).toContain(
			'@import "tailwindcss" source("..");',
		);
		const manifest = readFileSync(join(output, ".fizzyx/admin-manifest.json"), "utf8");
		expect(manifest).toContain('"app/(admin)/page.tsx"');
		expect(manifest).toContain('"preset": "forwardedPreset"');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rejects a malformed spec before executing any scaffold command", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-malformed-"));
	const spec = join(root, "openapi.json");
	const commands: string[][] = [];
	writeFileSync(spec, "{ definitely not json");
	const runner = {
		run: (argv: string[]) => {
			commands.push(argv);
			return Effect.succeed({ stdout: "", stderr: "" });
		},
	};

	try {
		await expect(
			Effect.runPromise(
				generateAdminProject({
					input: spec,
					output: join(root, "pet-admin"),
					framework: "nextjs",
				}).pipe(
					Effect.provideService(AdminProcessRunner, runner),
					Effect.provide(GeneratorRegistryLive),
				),
			),
		).rejects.toBeDefined();
		expect(commands).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("refreshes generated hashes after a quality failure so regeneration does not conflict", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-quality-recovery-"));
	const output = join(root, "pet-admin");
	let failQuality = true;
	const runner = {
		run: (argv: string[]) => {
			if (argv[0] === "bunx" && argv.includes("shadcn@latest") && argv.includes("init")) {
				mkdirSync(join(output, "app"), { recursive: true });
				writeFileSync(
					join(output, "package.json"),
					JSON.stringify({ scripts: { build: "next build" } }),
				);
			}
			if (failQuality && argv[0] === "bun" && argv[1] === "run" && argv[2] === "fmt") {
				failQuality = false;
				return Effect.fail(
					new AdminGenerationError({ message: "formatter failed", command: argv }),
				);
			}
			return Effect.succeed({ stdout: "", stderr: "" });
		},
	};

	try {
		await expect(
			Effect.runPromise(
				generateAdminProject({ input: fixture, output, framework: "nextjs" }).pipe(
					Effect.provideService(AdminProcessRunner, runner),
					Effect.provide(GeneratorRegistryLive),
				),
			),
		).rejects.toMatchObject({ message: "formatter failed" });

		const regenerated = await Effect.runPromise(
			generateAdminProject({ input: fixture, output, framework: "nextjs" }).pipe(
				Effect.provideService(AdminProcessRunner, runner),
				Effect.provide(GeneratorRegistryLive),
			),
		);
		expect(regenerated.conflicts).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
