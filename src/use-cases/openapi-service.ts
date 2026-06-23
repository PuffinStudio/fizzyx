import { Effect } from "effect";
import { existsSync } from "node:fs";
import type { CodeGenerator } from "../ports/code-generator";
import type { OpenApiLoader } from "../ports/openapi-loader";
import { ConfigRepo } from "../ports/config-repository";
import {
	CodegenError,
	ConfigValidationError,
	SpecLoadError,
	SpecParseError,
} from "../domain/errors";
import type {
	GenFileOptions,
	GeneratedFile,
	KnownGenerator,
	ParsedSpec,
} from "../domain/openapi-models";
import { openapiFileLoader } from "../adapters/openapi-file-loader";
import { openapiUrlLoader } from "../adapters/openapi-url-loader";
import { wxGenerator } from "../adapters/codegen-wx";

const BUILTIN_GENERATORS: Record<string, CodeGenerator> = {
	wx: wxGenerator,
};

const isUrl = (input: string): boolean =>
	input.startsWith("http://") || input.startsWith("https://");

function selectLoader(input: string): OpenApiLoader {
	return isUrl(input) ? openapiUrlLoader : openapiFileLoader;
}

export interface GenerateInput {
	input: string;
	output: string;
	client: string;
	apiName: string;
	typesName: string | false;
	runtimeName: string;
}

export interface GenerateResult {
	files: GeneratedFile[];
	spec: ParsedSpec;
	outputDir: string;
}

export interface GenerateManyResult {
	results: GenerateResult[];
}

function resolveOutputPath(output: string): { dir: string; opts: Partial<GenFileOptions> } {
	if (output.endsWith(".ts")) {
		const lastSlash = output.lastIndexOf("/");
		if (lastSlash >= 0) {
			return {
				dir: output.substring(0, lastSlash),
				opts: { apiName: output.substring(lastSlash + 1) },
			};
		}
		return { dir: ".", opts: { apiName: output } };
	}
	return { dir: output, opts: {} };
}

export const generate = (
	input: GenerateInput,
): Effect.Effect<GenerateResult, SpecLoadError | SpecParseError | CodegenError> =>
	Effect.gen(function* () {
		const loader = selectLoader(input.input);
		const spec = yield* loader.load(input.input);

		const generator = BUILTIN_GENERATORS[input.client];
		if (!generator) {
			return yield* Effect.fail(
				new CodegenError({
					message: `unknown client target: ${input.client}. available: ${Object.keys(BUILTIN_GENERATORS).join(", ")}`,
					target: input.client,
				}),
			);
		}

		const fileOpts: GenFileOptions = {
			apiName: input.apiName,
			typesName: input.typesName,
			runtimeName: input.runtimeName,
		};

		const files = yield* generator.generate(spec, input.output, fileOpts);
		return { files, spec, outputDir: input.output };
	});

function dedupeRuntimeFiles(
	results: { files: GeneratedFile[]; outputDir: string }[],
	shareRuntime: boolean,
): void {
	if (!shareRuntime) return;
	const seen = new Set<string>();
	for (const result of results) {
		const deduped: GeneratedFile[] = [];
		for (const file of result.files) {
			const fullPath = file.path.startsWith("/") ? file.path : `${result.outputDir}/${file.path}`;
			if (file.path.endsWith("-request.ts") || file.path.endsWith("request.ts")) {
				if (seen.has(fullPath)) continue;
				seen.add(fullPath);
			}
			deduped.push(file);
		}
		result.files.length = 0;
		result.files.push(...deduped);
	}
}

export const generateMany = (
	inputs: GenerateInput[],
	shareRuntime = false,
): Effect.Effect<GenerateManyResult, SpecLoadError | SpecParseError | CodegenError> =>
	Effect.gen(function* () {
		const results: GenerateResult[] = [];
		for (const input of inputs) {
			const r = yield* generate(input);
			results.push(r);
		}
		dedupeRuntimeFiles(results, shareRuntime);
		return { results };
	});

export const writeFiles = (files: GeneratedFile[], baseDir: string): Effect.Effect<void, Error> =>
	Effect.gen(function* () {
		for (const file of files) {
			const fullPath = file.path.startsWith("/") ? file.path : `${baseDir}/${file.path}`;
			yield* Effect.tryPromise({
				try: async () => {
					const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
					if (dir) {
						await Bun.$`mkdir -p ${dir}`.quiet();
					}
					await Bun.write(fullPath, file.content);
				},
				catch: (cause) =>
					new Error(
						`failed to write ${fullPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
					),
			});
		}
	});

export const writeManyFiles = (results: GenerateResult[]): Effect.Effect<void, Error> =>
	Effect.gen(function* () {
		for (const result of results) {
			yield* writeFiles(result.files, result.outputDir);
		}
	});

export const listGenerators = (): KnownGenerator[] =>
	Object.values(BUILTIN_GENERATORS).map((g) => g.info);

export interface GenerateCliInput {
	inputs?: string[];
	outputs?: string[];
	client?: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	run?: string;
}

export const generateFromCli = (cli: GenerateCliInput) =>
	Effect.gen(function* () {
		const resolved: GenerateInput[] = yield* resolveConfigs(cli);
		const shareRuntime = yield* resolveShareRuntime(cli);
		return yield* generateMany(resolved, shareRuntime);
	});

function resolveShareRuntime(_cli: GenerateCliInput) {
	return Effect.gen(function* () {
		if (!existsSync(".fizzy.yaml")) return false;
		const configRepo = yield* ConfigRepo;
		const projectConfig = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		const entries = projectConfig?.openapi;
		if (!entries) return false;
		return entries.some((e) => e.shareRuntime === true);
	});
}

function loadAllProjectOpenapiConfigs() {
	return Effect.gen(function* () {
		if (!existsSync(".fizzy.yaml")) return undefined;
		const configRepo = yield* ConfigRepo;
		const projectConfig = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		return projectConfig?.openapi;
	});
}

function resolveConfigs(cli: GenerateCliInput) {
	return Effect.gen(function* () {
		const configEntries = yield* loadAllProjectOpenapiConfigs();

		if (cli.inputs && cli.inputs.length > 0) {
			const cfg = configEntries?.[0];
			const client = cli.client ?? cfg?.client;
			if (!client) {
				return yield* Effect.fail(
					new ConfigValidationError({
						message: "--client required (target: wx)",
						field: "client",
					}),
				);
			}
			return cli.inputs.map((input, i) => {
				const rawOutput = cli.outputs?.[i] ?? cfg?.output;
				const { dir, opts } = resolveOutputPath(rawOutput ?? "./src/api");
				return {
					input,
					output: dir,
					client,
					apiName: cli.apiName ?? opts.apiName ?? "api.ts",
					typesName: cli.typesName ?? cfg?.typesName ?? opts.typesName ?? "types.ts",
					runtimeName: cli.runtimeName ?? cfg?.runtimeName ?? opts.runtimeName ?? "wx-request.ts",
				} satisfies GenerateInput;
			});
		}

		if (!configEntries || configEntries.length === 0) {
			return yield* Effect.fail(
				new ConfigValidationError({
					message: "--input required (spec file path or URL)",
					field: "input",
				}),
			);
		}

		return configEntries.map((cfg) => {
			const { dir, opts } = resolveOutputPath(cfg.output);
			return {
				input: cfg.input,
				output: dir,
				client: cfg.client,
				apiName: cfg.apiName ?? opts.apiName ?? "api.ts",
				typesName: cfg.typesName ?? opts.typesName ?? "types.ts",
				runtimeName: cfg.runtimeName ?? opts.runtimeName ?? "wx-request.ts",
			} satisfies GenerateInput;
		});
	});
}
