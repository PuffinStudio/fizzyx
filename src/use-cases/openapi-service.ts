import { Console, Effect } from "effect";
import type { CodeGenerator } from "../ports/code-generator";
import type { OpenApiLoader } from "../ports/openapi-loader";
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
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
}

export interface GenerateResult {
	files: GeneratedFile[];
	spec: ParsedSpec;
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

		const { dir, opts } = resolveOutputPath(input.output);
		const fileOpts: GenFileOptions = {
			apiName: input.apiName ?? opts.apiName ?? "api.ts",
			typesName: input.typesName ?? opts.typesName ?? "types.ts",
			runtimeName: input.runtimeName ?? opts.runtimeName ?? "wx-request.ts",
		};

		const files = yield* generator.generate(spec, dir, fileOpts);
		return { files, spec };
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

export const listGenerators = (): KnownGenerator[] =>
	Object.values(BUILTIN_GENERATORS).map((g) => g.info);

export interface GenerateCliInput {
	input?: string;
	output?: string;
	client?: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	config?: {
		input: string;
		output: string;
		client: string;
		apiName?: string;
		typesName?: string | false;
		runtimeName?: string;
	};
}

export const generateFromCli = (
	cli: GenerateCliInput,
): Effect.Effect<
	GenerateResult,
	SpecLoadError | SpecParseError | CodegenError | ConfigValidationError
> =>
	Effect.gen(function* () {
		const resolved: GenerateInput = yield* resolveConfig(cli);
		return yield* generate(resolved);
	});

function resolveConfig(cli: GenerateCliInput): Effect.Effect<GenerateInput, ConfigValidationError> {
	return Effect.gen(function* () {
		const input = cli.input ?? cli.config?.input;
		const client = cli.client ?? cli.config?.client;

		if (!input) {
			return yield* Effect.fail(
				new ConfigValidationError({
					message: "--input required (spec file path or URL)",
					field: "input",
				}),
			);
		}

		if (!client) {
			return yield* Effect.fail(
				new ConfigValidationError({
					message: "--client required (target: wx)",
					field: "client",
				}),
			);
		}

		const output = cli.output ?? cli.config?.output ?? "./src/api";

		// Warn if using default output and directory already has files.
		// Advisory only — proceed regardless.
		if (!cli.output && !cli.config?.output) {
			const hasFiles = yield* Effect.promise<boolean>(async () => {
				try {
					const dir = Bun.file(output);
					if (!(await dir.exists())) return false;
					const out = await Bun.$`ls -A ${output} 2>/dev/null | head -5`.text();
					return out.trim().length > 0;
				} catch {
					return false;
				}
			});
			if (hasFiles) {
				yield* Console.warn(`\x1b[33m⚠  output directory "${output}" already has files.\x1b[0m`);
				yield* Console.warn(
					`  \x1b[33mSet a custom --output to avoid overwriting existing code.\x1b[0m`,
				);
				yield* Console.warn(`  \x1b[33mOr configure it in .fizzy.yaml: openapi[0].output\x1b[0m`);
				yield* Console.warn("");
			}
		}

		return {
			input,
			output,
			client,
			apiName: cli.apiName ?? cli.config?.apiName,
			typesName: cli.typesName ?? cli.config?.typesName,
			runtimeName: cli.runtimeName ?? cli.config?.runtimeName,
		};
	});
}
