import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { generateFromCli, writeManyFiles, listGenerators } from "../use-cases/openapi-service";
import { withSpinner, logSuccess, logInfo } from "./ui";

const handleGenerate = (config: {
	input: ReadonlyArray<string>;
	output: ReadonlyArray<string>;
	client: Option.Option<string>;
	apiName: Option.Option<string>;
	typesName: Option.Option<string>;
	runtimeName: Option.Option<string>;
	posthook: Option.Option<string>;
	header: Option.Option<Record<string, string>>;
	stateManagement: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const allInputs = config.input.length > 0 ? (config.input as string[]) : undefined;
		const allOutputs = config.output.length > 0 ? (config.output as string[]) : undefined;
		const rawTypesName = Option.getOrElse(config.typesName, () => "types.ts");
		const resolvedTypesName = rawTypesName === "false" ? false : rawTypesName;

		const manyResult = yield* withSpinner(
			"Generating client...",
			generateFromCli({
				inputs: allInputs,
				outputs: allOutputs,
				client: Option.getOrElse(config.client, () => undefined),
				apiName: Option.getOrElse(config.apiName, () => undefined),
				typesName: resolvedTypesName,
				runtimeName: Option.getOrElse(config.runtimeName, () => undefined),
				posthook: Option.getOrElse(config.posthook, () => undefined),
				headers:
					Option.isSome(config.header) && Object.keys(config.header.value).length > 0
						? config.header.value
						: undefined,
				stateManagement: Option.getOrElse(config.stateManagement, () => undefined),
			}),
		);

		yield* writeManyFiles(manyResult.results);
		for (const result of manyResult.results) {
			yield* logSuccess(`generated ${result.files.length} file(s) to ${result.outputDir}`);
			yield* logInfo(
				`endpoints: ${result.spec.endpoints.length}  types: ${Object.keys(result.spec.types).length}`,
			);
			if (result.posthook) {
				yield* runPostGenScript(result.posthook);
			}
		}
	});

const handleList = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const generators = listGenerators();
		if (generators.length === 0) {
			yield* Console.log("(no generators available)");
			return;
		}
		yield* Console.log("available generators:");
		for (const g of generators) {
			yield* Console.log(`  ${g.name}  ${g.description}`);
		}
	});

const openapiGenerateCmd = Command.make(
	"generate",
	{
		input: Flag.string("input").pipe(
			Flag.withAlias("i"),
			Flag.withDescription("OpenAPI spec URL or file path (repeatable)"),
			Flag.atLeast(0),
		),
		output: Flag.string("output").pipe(
			Flag.withAlias("o"),
			Flag.withDescription("Output directory (repeatable, paired with --input)"),
			Flag.atLeast(0),
		),
		client: Flag.optional(
			Flag.string("client").pipe(
				Flag.withAlias("c"),
				Flag.withDescription("Client target (wx, fetch)"),
			),
		),
		apiName: Flag.optional(
			Flag.string("api-name").pipe(
				Flag.withDescription("Generated API filename (default: api.ts)"),
			),
		),
		typesName: Flag.optional(
			Flag.string("types-name").pipe(
				Flag.withDescription("Types filename (default: types.ts, use 'false' to inline)"),
			),
		),
		runtimeName: Flag.optional(
			Flag.string("runtime-name").pipe(
				Flag.withDescription("Runtime filename (default: wx-request.ts)"),
			),
		),
		posthook: Flag.optional(
			Flag.string("posthook").pipe(
				Flag.withDescription("Run a command after generation (e.g. --posthook 'bun run check')"),
			),
		),
		header: Flag.optional(
			Flag.keyValuePair("header").pipe(
				Flag.withDescription("Custom header for fetching spec (repeatable)"),
			),
		),
		stateManagement: Flag.optional(
			Flag.string("state-management").pipe(
				Flag.withDescription("State management integration (e.g. tanstack-query)"),
			),
		),
	},
	handleGenerate,
).pipe(
	Command.withAlias("g"),
	Command.withDescription("Generate API client code from OpenAPI spec"),
);

const openapiListCmd = Command.make("list", {}, handleList).pipe(
	Command.withDescription("List available client generators"),
);

const runPostGenScript = (script: string): Effect.Effect<void, any, any> =>
	Effect.tryPromise({
		try: async () => {
			const pkgPath = `${process.cwd()}/package.json`;
			const pkgFile = Bun.file(pkgPath);
			const exists = await pkgFile.exists();
			let cmd: string;
			if (exists) {
				const pkg = await pkgFile.json();
				if (pkg.scripts?.[script]) {
					cmd = `bun run ${script}`;
				} else {
					cmd = script;
				}
			} else {
				cmd = script;
			}
			process.stderr.write(`running: ${cmd}\n`);
			const proc = Bun.spawnSync(cmd.split(" "), {
				stdio: ["inherit", "inherit", "inherit"],
			});
			if (proc.exitCode !== 0) {
				throw new Error(`"${cmd}" exited with code ${proc.exitCode}`);
			}
		},
		catch: (cause) =>
			new Error(
				`post-gen script failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});

export const openapiCmd = Command.make("openapi").pipe(
	Command.withDescription("Generate API client code from OpenAPI specs"),
	Command.withSubcommands([openapiGenerateCmd, openapiListCmd]),
);
