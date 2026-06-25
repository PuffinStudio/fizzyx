import { Effect } from "effect";
import { existsSync } from "node:fs";
import type { CodeExtensionGenerator, CodeGenerator } from "../ports/code-generator";
import type { OpenApiLoader } from "../ports/openapi-loader";
import {
	ConfigRepo,
	CONFIG_FILE,
	LEGACY_CONFIG_FILE,
	type ConfigRepository,
} from "../ports/config-repository";
import {
	CodegenError,
	FileError,
	ConfigError,
	ConfigValidationError,
	SpecLoadError,
	SpecParseError,
} from "../domain/errors";
import type {
	GenFileOptions,
	GeneratedFile,
	KnownGenerator,
	ParsedSpec,
	OpenApiGenConfig,
	OpenApiProjectConfig,
} from "../domain/openapi-models";
import { openapiFileLoader } from "../adapters/openapi-file-loader";
import { openapiUrlLoader } from "../adapters/openapi-url-loader";
import { wxGenerator } from "../adapters/codegen-wx";
import { fetchGenerator } from "../adapters/codegen-fetch";
import { effectGenerator, EFFECT_GENERATOR_DEFAULTS } from "../adapters/codegen-effect";
import { tanstackQueryGenerator } from "../adapters/codegen-tanstack-query";
import { generateIndexFile, planOpenApiArtifacts } from "./openapi-artifact-plan";

const BUILTIN_GENERATORS: Record<string, CodeGenerator> = {
	wx: wxGenerator,
	fetch: fetchGenerator,
	effect: effectGenerator,
};

const STATE_MANAGEMENT_PLUGINS: Record<string, CodeExtensionGenerator> = {
	"tanstack-query": tanstackQueryGenerator,
};

const configFileExists = (): boolean => existsSync(CONFIG_FILE) || existsSync(LEGACY_CONFIG_FILE);

const isUrl = (input: string): boolean =>
	input.startsWith("http://") || input.startsWith("https://");

const DEFAULT_OPENAPI_INPUT = "";
const DEFAULT_OPENAPI_OUTPUT = "./src/api";
const DEFAULT_OPENAPI_CLIENT = "fetch";

const SUPPORTED_OPENAPI_CLIENTS = new Set(["wx", "fetch", "effect"]);

const normalizeClient = (value: string): string => value.trim().toLowerCase();

function selectLoader(input: string): OpenApiLoader {
	return isUrl(input) ? openapiUrlLoader : openapiFileLoader;
}

export interface GenerateInput {
	input: string;
	output: string;
	client: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	posthook?: string;
	headers?: Record<string, string>;
	stateManagement?: string;
}

export interface GenerateResult {
	files: GeneratedFile[];
	spec: ParsedSpec;
	outputDir: string;
	posthook?: string;
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
		const spec = yield* loader.load(input.input, input.headers);

		const generator = BUILTIN_GENERATORS[input.client];
		if (!generator) {
			return yield* Effect.fail(
				new CodegenError({
					message: `unknown client target: ${input.client}. available: ${Object.keys(BUILTIN_GENERATORS).join(", ")}`,
					target: input.client,
				}),
			);
		}

		const generatorDefaults =
			input.client === "effect"
				? {
						apiName: EFFECT_GENERATOR_DEFAULTS.apiName,
						runtimeName: EFFECT_GENERATOR_DEFAULTS.runtimeName,
					}
				: {};
		const fileOpts = {
			...generatorDefaults,
			...Object.fromEntries(
				Object.entries({
					apiName: input.apiName,
					typesName: input.typesName,
					runtimeName: input.runtimeName,
				}).filter(([_, v]) => v !== undefined),
			),
		};

		const files = yield* generator.generate(spec, input.output, fileOpts);
		const artifactPlan = planOpenApiArtifacts(spec, fileOpts);
		const extensionExports: string[] = [];

		// State management plugin
		if (input.stateManagement) {
			const plugin = STATE_MANAGEMENT_PLUGINS[input.stateManagement];
			if (!plugin) {
				return yield* Effect.fail(
					new CodegenError({
						message: `unknown state management: ${input.stateManagement}. available: ${Object.keys(STATE_MANAGEMENT_PLUGINS).join(", ")}`,
						target: input.stateManagement,
					}),
				);
			}
			const smFiles = yield* plugin.generate(spec, input.output, fileOpts);
			files.push(...smFiles);
			extensionExports.push(plugin.exportPath);
		}

		files.push(generateIndexFile(artifactPlan, extensionExports));

		return { files, spec, outputDir: input.output, posthook: input.posthook };
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

export interface OpenApiInitInput {
	input?: string;
	output?: string;
	client?: string;
	force?: boolean;
}

export const initOpenApiConfig = (
	options: OpenApiInitInput = {},
): Effect.Effect<boolean, ConfigError | FileError, ConfigRepository> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const projectConfig = configFileExists()
			? yield* configRepo.loadProjectConfig().pipe(Effect.catch((cause) => Effect.fail(cause)))
			: undefined;

		const hasOpenApiConfig = (projectConfig?.openapi?.entries?.length ?? 0) > 0;
		if (hasOpenApiConfig && !options.force) {
			return false;
		}

		const resolvedClient = normalizeClient(options.client ?? DEFAULT_OPENAPI_CLIENT);
		const supportedClient = SUPPORTED_OPENAPI_CLIENTS.has(resolvedClient)
			? resolvedClient
			: DEFAULT_OPENAPI_CLIENT;

		const entry: OpenApiGenConfig = {
			input: options.input?.trim() || DEFAULT_OPENAPI_INPUT,
			output: options.output || DEFAULT_OPENAPI_OUTPUT,
			client: supportedClient,
		};

		const configPath = projectConfig?.configPath ?? `${process.cwd()}/${CONFIG_FILE}`;
		yield* configRepo.setupOpenApiConfig({
			entry,
			force: options.force ?? false,
			configPath,
		});
		return true;
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
	posthook?: string;
	headers?: Record<string, string>;
	stateManagement?: string;
}

export const generateFromCli = (cli: GenerateCliInput) =>
	Effect.gen(function* () {
		const resolved: GenerateInput[] = yield* resolveConfigs(cli);
		const shareRuntime = yield* resolveShareRuntime(cli);
		return yield* generateMany(resolved, shareRuntime);
	});

function resolveShareRuntime(_cli: GenerateCliInput) {
	return Effect.gen(function* () {
		if (!configFileExists()) return false;
		const configRepo = yield* ConfigRepo;
		const projectConfig = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		const pc = projectConfig?.openapi;
		if (!pc?.entries) return false;
		return pc.entries.some((e) => e.shareRuntime === true);
	});
}

function loadAllProjectOpenapiConfigs() {
	return Effect.gen(function* () {
		if (!configFileExists()) return undefined;
		const configRepo = yield* ConfigRepo;
		const projectConfig = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		return projectConfig?.openapi;
	});
}

function resolveConfigs(cli: GenerateCliInput) {
	return Effect.gen(function* () {
		const projectCfg: OpenApiProjectConfig | undefined = yield* loadAllProjectOpenapiConfigs();
		const entries = projectCfg?.entries;
		const globalPosthook = projectCfg?.posthook;

		if (cli.inputs && cli.inputs.length > 0) {
			const first = entries?.[0];
			const client = cli.client ?? first?.client;
			if (!client) {
				return yield* Effect.fail(
					new ConfigValidationError({
						message: "--client required (targets: wx, fetch)",
						field: "client",
					}),
				);
			}
			return cli.inputs.map((input, i) => {
				const rawOutput = cli.outputs?.[i] ?? first?.output;
				const { dir, opts } = resolveOutputPath(rawOutput ?? "./src/api");
				return {
					input,
					output: dir,
					client,
					apiName: cli.apiName ?? opts.apiName ?? first?.apiName,
					typesName: cli.typesName ?? first?.typesName ?? opts.typesName,
					runtimeName: cli.runtimeName ?? first?.runtimeName ?? opts.runtimeName,
					posthook: cli.posthook,
					headers: cli.headers ?? first?.headers,
					stateManagement: cli.stateManagement ?? first?.stateManagement,
				} satisfies GenerateInput;
			});
		}

		if (!entries || entries.length === 0) {
			return yield* Effect.fail(
				new ConfigValidationError({
					message: "--input required (spec file path or URL)",
					field: "input",
				}),
			);
		}

		return entries.map((cfg) => {
			const { dir, opts } = resolveOutputPath(cfg.output);
			return {
				input: cfg.input,
				output: dir,
				client: cfg.client,
				apiName: cfg.apiName ?? opts.apiName,
				typesName: cfg.typesName ?? opts.typesName,
				runtimeName: cfg.runtimeName ?? opts.runtimeName,
				posthook: cfg.posthook ?? globalPosthook,
				headers: cfg.headers,
				stateManagement: cfg.stateManagement,
			} satisfies GenerateInput;
		});
	});
}
