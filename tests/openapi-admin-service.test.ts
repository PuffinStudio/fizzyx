import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
			if (!rejectedBun && argv[0] === "bun") {
				rejectedBun = true;
				return Effect.fail(
					new AdminGenerationError({
						message: "bun scaffold failed",
						command: argv,
						stderr: "Bun is not supported by this CLI version",
					}),
				);
			}
			if (argv[0] === "pnpm" && argv.includes("create")) {
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
