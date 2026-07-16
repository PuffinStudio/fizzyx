import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const runSmoke = process.env.FIZZYX_RUN_ADMIN_SMOKE === "1";
const fixture = join(import.meta.dir, "fixtures", "openapi-admin-pets.json");
const entry = join(import.meta.dir, "..", "src", "main.ts");

for (const framework of ["nextjs", "tanstack-start"] as const) {
	test.skipIf(!runSmoke)(
		`generated ${framework} project passes its production build`,
		async () => {
			const root = mkdtempSync(join(tmpdir(), `fizzyx-admin-${framework}-`));
			const output = join(root, "pet-admin");
			try {
				const generate = Bun.spawn(
					[
						"bun",
						"run",
						entry,
						"openapi",
						"admin",
						"--input",
						fixture,
						"--output",
						output,
						"--framework",
						framework,
						"--create-mode",
						"dialog",
					],
					{ cwd: join(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" },
				);
				const [generateExit, generateStdout, generateStderr] = await Promise.all([
					generate.exited,
					new Response(generate.stdout).text(),
					new Response(generate.stderr).text(),
				]);
				expect(generateExit, `${generateStdout}\n${generateStderr}`).toBe(0);

				const build = Bun.spawn(["bun", "run", "build"], {
					cwd: output,
					stdout: "pipe",
					stderr: "pipe",
				});
				const [buildExit, buildStdout, buildStderr] = await Promise.all([
					build.exited,
					new Response(build.stdout).text(),
					new Response(build.stderr).text(),
				]);
				expect(buildExit, `${buildStdout}\n${buildStderr}`).toBe(0);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		},
		180_000,
	);
}
