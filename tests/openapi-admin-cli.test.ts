import { expect, test } from "bun:test";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

test("openapi admin help documents the project generation contract", async () => {
	const entry = join(import.meta.dir, "..", "src", "main.ts");
	const proc = Bun.spawn(["bun", "run", entry, "openapi", "admin", "--help"], {
		cwd: join(import.meta.dir, ".."),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx openapi admin");
	expect(stdout).toContain("--input");
	expect(stdout).toContain("--output");
	expect(stdout).toContain("--framework");
	expect(stdout).toContain("--preset");
	expect(stdout).toContain("--create-mode");
});

test("openapi admin dry-run plans Bun commands without creating the project", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-cli-"));
	try {
		const entry = join(import.meta.dir, "..", "src", "main.ts");
		const specPath = join(root, "openapi.json");
		const output = join(root, "pet-admin");
		writeFileSync(
			specPath,
			JSON.stringify({
				openapi: "3.0.0",
				info: { title: "Pet Store", version: "1.0.0" },
				paths: {
					"/pets": {
						get: { operationId: "listPets", responses: { "200": { description: "ok" } } },
					},
				},
			}),
		);
		const proc = Bun.spawn(
			[
				"bun",
				"run",
				entry,
				"openapi",
				"admin",
				"--input",
				specPath,
				"--output",
				output,
				"--framework",
				"nextjs",
				"--preset",
				"customPreset123",
				"--create-mode",
				"dialog",
				"--dry-run",
			],
			{ cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("bun create next-app@latest");
		expect(stdout).toContain("--preset customPreset123");
		expect(stdout).not.toMatch(/\bnpm|\bnpx/);
		expect(await Bun.file(output).exists()).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi admin can use optional project defaults without CLI flags", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-config-cli-"));
	try {
		const entry = join(import.meta.dir, "..", "src", "main.ts");
		const specPath = join(root, "openapi.json");
		const output = join(root, "configured-admin");
		writeFileSync(
			specPath,
			JSON.stringify({
				openapi: "3.0.0",
				info: { title: "Configured", version: "1.0.0" },
				paths: {},
			}),
		);
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`openapi:\n  admin:\n    input: ${specPath}\n    output: ${output}\n    framework: tanstack-start\n    preset: configuredPreset456\n    create_mode: dialog\n`,
		);
		const proc = Bun.spawn(["bun", "run", entry, "openapi", "admin", "--dry-run"], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("@tanstack/cli@latest");
		expect(stdout).toContain("--preset configuredPreset456");
		expect(await Bun.file(output).exists()).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
