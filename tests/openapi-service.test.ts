import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const runCli = async (
	args: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<CliResult> => {
	const projectRoot = join(import.meta.dir, "..");
	const entry = join(projectRoot, "src", "main.ts");
	const proc = Bun.spawn(["bun", "run", entry, ...args], {
		cwd: options?.cwd || projectRoot,
		env: {
			...process.env,
			...options?.env,
		} as NodeJS.ProcessEnv,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
};

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-openapi-"));

const SAMPLE_SPEC = {
	openapi: "3.0.0",
	info: { title: "Pet Store", version: "1.0.0" },
	paths: {
		"/pets": {
			get: {
				operationId: "listPets",
				summary: "List all pets",
				parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
				responses: {
					"200": {
						description: "Pet list",
						content: {
							"application/json": {
								schema: {
									type: "array",
									items: { $ref: "#/components/schemas/Pet" },
								},
							},
						},
					},
				},
			},
			post: {
				operationId: "createPet",
				summary: "Create a pet",
				requestBody: {
					required: true,
					content: {
						"application/json": {
							schema: { $ref: "#/components/schemas/CreatePetInput" },
						},
					},
				},
				responses: {
					"201": {
						description: "Created pet",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Pet" },
							},
						},
					},
				},
			},
		},
		"/pets/{petId}": {
			get: {
				operationId: "getPetById",
				summary: "Get pet by ID",
				parameters: [
					{
						name: "petId",
						in: "path",
						required: true,
						schema: { type: "integer" },
					},
				],
				responses: {
					"200": {
						description: "A pet",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/Pet" },
							},
						},
					},
				},
			},
			delete: {
				operationId: "deletePet",
				summary: "Delete a pet",
				parameters: [
					{
						name: "petId",
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				],
				responses: { "204": { description: "Deleted" } },
			},
		},
	},
	components: {
		schemas: {
			Pet: {
				type: "object",
				required: ["id", "name"],
				properties: {
					id: { type: "integer" },
					name: { type: "string" },
					tag: { type: "string" },
				},
			},
			CreatePetInput: {
				type: "object",
				required: ["name"],
				properties: {
					name: { type: "string" },
					tag: { type: "string" },
				},
			},
		},
	},
};

test("openapi generate --help prints usage", async () => {
	const { stdout, exitCode } = await runCli(["openapi", "generate", "--help"]);
	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx openapi generate");
	expect(stdout).toContain("--input");
	expect(stdout).toContain("--output");
	expect(stdout).toContain("--client");
	expect(stdout).toContain("--api-name");
	expect(stdout).toContain("--types-name");
	expect(stdout).toContain("--runtime-name");
});

test("openapi list shows wx generator", async () => {
	const { stdout, exitCode } = await runCli(["openapi", "list"]);
	expect(exitCode).toBe(0);
	expect(stdout).toContain("wx");
	expect(stdout).toContain("WeChat Mini Program");
});

test("openapi generate requires --input", async () => {
	const root = makeTempDir();
	try {
		const { stderr, exitCode } = await runCli(["openapi", "generate", "-o", root, "-c", "wx"], {
			cwd: root,
		});
		expect(exitCode).not.toBe(0);
		expect(stderr).toMatch(/input|--input/i);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate produces correct files from spec file", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		const outputDir = join(root, "api");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));

		const { stdout, stderr, exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			outputDir,
			"-c",
			"wx",
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("generated 4 file(s)");
		expect(stdout).toContain("endpoints: 4");
		expect(stdout).toContain("types: 2");

		expect(existsSync(join(outputDir, "types.ts"))).toBe(true);
		expect(existsSync(join(outputDir, "wx-request.ts"))).toBe(true);
		expect(existsSync(join(outputDir, "api.ts"))).toBe(true);
		expect(existsSync(join(outputDir, "index.ts"))).toBe(true);

		const types = readFileSync(join(outputDir, "types.ts"), "utf-8");
		expect(types).toContain("export interface Pet {");
		expect(types).toContain("  id: number");
		expect(types).toContain("  name: string");
		expect(types).toContain("export interface CreatePetInput {");

		const runtime = readFileSync(join(outputDir, "wx-request.ts"), "utf-8");
		expect(runtime).toContain("export function configure");
		expect(runtime).toContain("export function setToken");
		expect(runtime).toContain("export function onError");
		expect(runtime).toContain("export async function request");
		expect(runtime).toContain("wx.request({");
		expect(runtime).toContain("export async function initToken");
		expect(runtime).toContain("console.error");
		expect(runtime).toContain("reject(new Error(errMsg))");
		expect(runtime).toContain("hasHooks");

		const api = readFileSync(join(outputDir, "api.ts"), "utf-8");
		expect(api).toContain("export function listPets");
		expect(api).toContain("export function createPet");
		expect(api).toContain("export function getPetById");
		expect(api).toContain("export function deletePet");
		expect(api).toContain("Pet[]");
		expect(api).toContain("CreatePetInput");
		expect(api).toContain("export interface ListPetsQueryParams extends BaseParams {");
		expect(api).toContain("  limit?: number");
		expect(api).toContain("export interface GetPetByIdPathParams extends BaseParams {");
		expect(api).toContain("  petId: number");
		expect(api).toContain("export interface DeletePetPathParams extends BaseParams {");
		expect(api).toContain("  petId: string");
		expect(api).toContain("export interface BaseParams {");

		const idx = readFileSync(join(outputDir, "index.ts"), "utf-8");
		expect(idx).toContain('export * from "./api"');
		expect(idx).toContain('export * from "./types"');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate creates .fizzy.yaml when no config exists", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		const outputDir = join(root, "api");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));

		const fizzyPath = join(root, ".fizzy.yaml");
		expect(existsSync(fizzyPath)).toBe(false);

		const { stdout, exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			outputDir,
			"-c",
			"wx",
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("generated 4 file(s)");

		expect(existsSync(join(outputDir, "api.ts"))).toBe(true);
		expect(existsSync(join(outputDir, "index.ts"))).toBe(true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate with --output file path sets custom api name", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));

		const { exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			join(root, "api", "sdk.ts"),
			"-c",
			"wx",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(join(root, "api", "sdk.ts"))).toBe(true);
		expect(existsSync(join(root, "api", "types.ts"))).toBe(true);
		expect(existsSync(join(root, "api", "wx-request.ts"))).toBe(true);

		const api = readFileSync(join(root, "api", "sdk.ts"), "utf-8");
		expect(api).toContain("export function listPets");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate with --api-name flag", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));
		const outDir = join(root, "api");

		const { exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			outDir,
			"-c",
			"wx",
			"--api-name",
			"client.ts",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(join(outDir, "client.ts"))).toBe(true);
		expect(existsSync(join(outDir, "types.ts"))).toBe(true);

		const api = readFileSync(join(outDir, "client.ts"), "utf-8");
		expect(api).toContain("export function listPets");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate with --types-name flag", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));
		const outDir = join(root, "api");

		const { exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			outDir,
			"-c",
			"wx",
			"--types-name",
			"models.ts",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(join(outDir, "models.ts"))).toBe(true);
		expect(existsSync(join(outDir, "api.ts"))).toBe(true);

		const types = readFileSync(join(outDir, "models.ts"), "utf-8");
		expect(types).toContain("export interface Pet");

		// api.ts should import from ./models, not ./types
		const api = readFileSync(join(outDir, "api.ts"), "utf-8");
		expect(api).toContain('from "./models"');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate with custom runtime name", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));
		const outDir = join(root, "api");

		const { exitCode } = await runCli([
			"openapi",
			"generate",
			"-i",
			specPath,
			"-o",
			outDir,
			"-c",
			"wx",
			"--runtime-name",
			"request.ts",
		]);

		expect(exitCode).toBe(0);
		expect(existsSync(join(outDir, "request.ts"))).toBe(true);
		expect(existsSync(join(outDir, "types.ts"))).toBe(true);
		expect(existsSync(join(outDir, "api.ts"))).toBe(true);

		const runtime = readFileSync(join(outDir, "request.ts"), "utf-8");
		expect(runtime).toContain("export function configure");

		// api.ts should import from ./request, not ./wx-request
		const api = readFileSync(join(outDir, "api.ts"), "utf-8");
		expect(api).toContain('from "./request"');
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate --run with npm script name", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));
		writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { check: "echo done" } }));
		const outDir = join(root, "api");

		const { stderr, exitCode } = await runCli(
			["openapi", "generate", "-i", specPath, "-o", outDir, "-c", "wx", "--run", "check"],
			{ cwd: root },
		);

		expect(exitCode).toBe(0);
		expect(stderr).toContain("running: bun run check");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("openapi generate --run with raw command", async () => {
	const root = makeTempDir();
	try {
		const specPath = join(root, "spec.json");
		writeFileSync(specPath, JSON.stringify(SAMPLE_SPEC, null, 2));
		const outDir = join(root, "api");

		const { stderr, exitCode } = await runCli(
			["openapi", "generate", "-i", specPath, "-o", outDir, "-c", "wx", "--run", "echo", "hello"],
			{ cwd: root },
		);

		expect(exitCode).toBe(0);
		expect(stderr).toContain("running: echo");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
