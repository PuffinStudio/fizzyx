import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	commitAdminManifestApplied,
	readAdminManifestMetadata,
	writeAdminGeneratedFiles,
} from "../src/use-cases/openapi-admin-manifest";

const readManifest = (root: string): any =>
	JSON.parse(readFileSync(join(root, ".fizzyx/admin-manifest.json"), "utf8"));

test("preserves a user-modified generated file and reports a regeneration conflict", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		const first = writeAdminGeneratedFiles(
			root,
			[{ path: "src/generated/page.tsx", content: "v1\n" }],
			{
				framework: "nextjs",
				packageManager: "bun",
				specFingerprint: "spec-v1",
				specSource: "./openapi.yaml",
				preset: "preset123",
				createMode: "dialog",
			},
		);
		expect(first.conflicts).toEqual([]);

		const generatedPath = join(root, "src/generated/page.tsx");
		writeFileSync(generatedPath, "user edit\n");
		const second = writeAdminGeneratedFiles(
			root,
			[{ path: "src/generated/page.tsx", content: "v2\n" }],
			{ framework: "nextjs", packageManager: "bun", specFingerprint: "spec-v2" },
		);

		expect(second.conflicts).toEqual(["src/generated/page.tsx"]);
		expect(readFileSync(generatedPath, "utf8")).toBe("user edit\n");
		const manifest = readManifest(root);
		expect(manifest.version).toBe(2);
		expect(manifest.generatorVersion).toBeString();
		expect(manifest.templateVersion).toBe(2);
		expect(manifest.appliedSpecFingerprint).toBe("spec-v1");
		expect(manifest.pendingSpecFingerprint).toBe("spec-v2");
		expect(manifest.specSource).toBe("./openapi.yaml");
		expect(manifest.preset).toBe("preset123");
		expect(manifest.createMode).toBe("dialog");
		expect(manifest.files["src/generated/page.tsx"]).toMatchObject({
			ownership: "generated",
			baseHash: expect.any(String),
			generatedHash: expect.any(String),
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("preflights every conflict before writing or deleting generated files", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		const metadata = {
			framework: "nextjs" as const,
			packageManager: "bun" as const,
			specFingerprint: "spec-v1",
		};
		writeAdminGeneratedFiles(
			root,
			[
				{ path: "src/generated/first.ts", content: "first v1\n" },
				{ path: "src/generated/obsolete.ts", content: "obsolete\n" },
				{ path: "src/generated/conflict.ts", content: "conflict v1\n" },
			],
			metadata,
		);
		writeFileSync(join(root, "src/generated/conflict.ts"), "user edit\n");

		const result = writeAdminGeneratedFiles(
			root,
			[
				{ path: "src/generated/first.ts", content: "first v2\n" },
				{ path: "src/generated/conflict.ts", content: "conflict v2\n" },
			],
			{ ...metadata, specFingerprint: "spec-v2" },
		);

		expect(result).toEqual({
			written: [],
			conflicts: ["src/generated/conflict.ts"],
			deleted: [],
		});
		expect(readFileSync(join(root, "src/generated/first.ts"), "utf8")).toBe("first v1\n");
		expect(readFileSync(join(root, "src/generated/obsolete.ts"), "utf8")).toBe("obsolete\n");
		expect(readManifest(root)).toMatchObject({
			appliedSpecFingerprint: "spec-v1",
			pendingSpecFingerprint: "spec-v2",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("keeps the applied plan snapshot until a deferred candidate is committed", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		const oldPlan = { resources: [{ key: "pets" }] };
		const candidatePlan = { resources: [{ key: "owners" }] };
		writeAdminGeneratedFiles(root, [{ path: "generated.ts", content: "v1\n" }], {
			framework: "nextjs",
			packageManager: "bun",
			specFingerprint: "spec-v1",
			adminPlanSnapshot: oldPlan,
		});

		writeAdminGeneratedFiles(
			root,
			[{ path: "generated.ts", content: "v2\n" }],
			{
				framework: "nextjs",
				packageManager: "bun",
				specFingerprint: "spec-v2",
				adminPlanSnapshot: candidatePlan,
			},
			{ deferAppliedFingerprint: true },
		);

		expect(readManifest(root)).toMatchObject({
			appliedSpecFingerprint: "spec-v1",
			pendingSpecFingerprint: "spec-v2",
			adminPlanSnapshot: oldPlan,
		});

		commitAdminManifestApplied(root, "spec-v2", candidatePlan);
		expect(readManifest(root)).toMatchObject({
			appliedSpecFingerprint: "spec-v2",
			pendingSpecFingerprint: null,
			adminPlanSnapshot: candidatePlan,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("keeps the applied plan snapshot when staging a conflict", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		const oldPlan = { resources: [{ key: "pets" }] };
		writeAdminGeneratedFiles(root, [{ path: "generated.ts", content: "v1\n" }], {
			framework: "nextjs",
			packageManager: "bun",
			specFingerprint: "spec-v1",
			adminPlanSnapshot: oldPlan,
		});
		writeFileSync(join(root, "generated.ts"), "user edit\n");

		writeAdminGeneratedFiles(root, [{ path: "generated.ts", content: "v2\n" }], {
			framework: "nextjs",
			packageManager: "bun",
			specFingerprint: "spec-v2",
			adminPlanSnapshot: { resources: [{ key: "owners" }] },
		});

		expect(readManifest(root)).toMatchObject({
			appliedSpecFingerprint: "spec-v1",
			pendingSpecFingerprint: "spec-v2",
			adminPlanSnapshot: oldPlan,
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reads v1 metadata and upgrades its file hashes on the next successful write", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		writeFileSync(join(root, "legacy.ts"), "legacy\n");
		mkdirSync(join(root, ".fizzyx"));
		writeFileSync(
			join(root, ".fizzyx/admin-manifest.json"),
			JSON.stringify({
				version: 1,
				framework: "nextjs",
				packageManager: "bun",
				specFingerprint: "legacy-spec",
				files: {
					"legacy.ts": new Bun.CryptoHasher("sha256").update("legacy\n").digest("hex"),
				},
			}),
			{ flag: "wx" },
		);

		expect(readAdminManifestMetadata(root)?.specFingerprint).toBe("legacy-spec");
		writeAdminGeneratedFiles(root, [{ path: "legacy.ts", content: "next\n" }], {
			framework: "nextjs",
			packageManager: "bun",
			specFingerprint: "next-spec",
			adminPlanSnapshot: { resources: [] },
		});

		const manifest = readManifest(root);
		expect(manifest).toMatchObject({
			version: 2,
			appliedSpecFingerprint: "next-spec",
			pendingSpecFingerprint: null,
			adminPlanSnapshot: { resources: [] },
		});
		expect(manifest.files["legacy.ts"].ownership).toBe("generated");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("removes an obsolete generated file only when it was not modified", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-manifest-"));
	try {
		const metadata = {
			framework: "nextjs" as const,
			packageManager: "bun" as const,
			specFingerprint: "spec-v1",
			specSource: "./openapi.yaml",
		};
		writeAdminGeneratedFiles(
			root,
			[
				{ path: "src/generated/keep.ts", content: "keep\n" },
				{ path: "src/generated/remove.ts", content: "remove\n" },
			],
			metadata,
		);

		const result = writeAdminGeneratedFiles(
			root,
			[{ path: "src/generated/keep.ts", content: "keep v2\n" }],
			{ ...metadata, specFingerprint: "spec-v2" },
		);

		expect(result.deleted).toEqual(["src/generated/remove.ts"]);
		expect(existsSync(join(root, "src/generated/remove.ts"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
