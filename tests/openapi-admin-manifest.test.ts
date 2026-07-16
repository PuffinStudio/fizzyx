import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeAdminGeneratedFiles } from "../src/use-cases/openapi-admin-manifest";

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
		const manifest = readFileSync(join(root, ".fizzyx/admin-manifest.json"), "utf8");
		expect(manifest).toContain('"framework": "nextjs"');
		expect(manifest).toContain('"specSource": "./openapi.yaml"');
		expect(manifest).toContain('"preset": "preset123"');
		expect(manifest).toContain('"createMode": "dialog"');
		expect(manifest).toStartWith('{\n  "version"');
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
