import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import {
	initOpenApiConfig,
	listGenerators,
	runOpenApiGenerateLifecycle,
} from "../use-cases/openapi-service";
import { generateAdminProject } from "../use-cases/openapi-admin-service";
import { ConfigRepo } from "../ports/config-repository";
import {
	formatGeneratedDetails,
	formatGeneratedOutput,
	formatOpenApiInitDone,
	formatOpenApiInitMessage,
	formatOpenApiInitSkipped,
	formatGeneratorItem,
	formatGeneratorsHeader,
	formatNoGenerators,
	formatGeneratingClientMessage,
} from "./openapi-output";
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
			formatGeneratingClientMessage(),
			runOpenApiGenerateLifecycle({
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

		for (const result of manyResult.results) {
			yield* logSuccess(formatGeneratedOutput(result.files.length, result.outputDir));
			yield* logInfo(
				formatGeneratedDetails(result.spec.endpoints.length, Object.keys(result.spec.types).length),
			);
		}
	});

const handleList = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const generators = yield* listGenerators();
		if (generators.length === 0) {
			yield* Console.log(formatNoGenerators());
			return;
		}
		yield* Console.log(formatGeneratorsHeader());
		for (const g of generators) {
			yield* Console.log(formatGeneratorItem(g.name, g.description));
		}
	});

const promptLine = (message: string): Effect.Effect<string, any, any> =>
	Effect.tryPromise({
		try: () =>
			new Promise<string>((resolve) => {
				const rl = require("node:readline").createInterface({
					input: process.stdin,
					output: process.stderr,
				});
				rl.question(message, (value: string) => {
					rl.close();
					resolve(value.trim());
				});
			}),
		catch: (cause) => new Error(String(cause)),
	});

const resolveClient = (raw: string): string | undefined => {
	const normalized = raw.trim().toLowerCase();
	if (normalized === "") return undefined;
	if (normalized === "1") return "fetch";
	if (normalized === "2") return "wx";
	if (normalized === "3") return "effect";
	if (normalized === "fetch" || normalized === "wx" || normalized === "effect") return normalized;
	return undefined;
};

const promptOpenApiClient = (): Effect.Effect<string, any, any> =>
	Effect.gen(function* () {
		const raw = yield* promptLine("OpenAPI client (1=fetch, 2=wx, 3=effect) [fetch]: ");
		const client = resolveClient(raw);
		if (client) return client;
		yield* logInfo("Please enter 1, 2, 3, fetch, wx, or effect");
		return yield* promptOpenApiClient();
	});

const handleInit = (config: {
	input: Option.Option<string>;
	output: Option.Option<string>;
	client: Option.Option<string>;
	force: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		let input = Option.getOrElse(config.input, () => "");
		let output = Option.getOrElse(config.output, () => "");
		let client = Option.getOrElse(config.client, () => "");

		if (process.stdin.isTTY) {
			if (!input) {
				input = yield* promptLine("OpenAPI spec URL or file path: ");
			}
			if (!output) {
				output = yield* promptLine("Output directory [./src/api]: ");
			}
			if (!client) {
				client = yield* promptOpenApiClient();
			}
		}

		const wrote = yield* withSpinner(
			formatOpenApiInitMessage(),
			initOpenApiConfig({
				input: input || undefined,
				output: output || undefined,
				client: client || undefined,
				force: config.force,
			}),
		);

		if (wrote) {
			yield* logSuccess(formatOpenApiInitDone());
			return;
		}
		yield* logInfo(formatOpenApiInitSkipped());
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

const openapiInitCmd = Command.make(
	"init",
	{
		input: Flag.optional(
			Flag.string("input").pipe(Flag.withAlias("i"), Flag.withDescription("OpenAPI spec URL/path")),
		),
		output: Flag.optional(
			Flag.string("output").pipe(Flag.withAlias("o"), Flag.withDescription("Output directory")),
		),
		client: Flag.optional(
			Flag.string("client").pipe(
				Flag.withAlias("c"),
				Flag.withDescription("Client target (wx, fetch, effect)"),
			),
		),
		force: Flag.boolean("force").pipe(
			Flag.withDescription("Replace existing openapi config block"),
		),
	},
	handleInit,
).pipe(Command.withDescription("Create a blank OpenAPI config scaffold in .fizzyx.yaml"));

const openapiListCmd = Command.make("list", {}, handleList).pipe(
	Command.withDescription("List available client generators"),
);

const handleAdmin = (config: {
	input: Option.Option<string>;
	output: Option.Option<string>;
	framework: Option.Option<"nextjs" | "tanstack-start">;
	dryRun: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const repository = yield* ConfigRepo;
		const project = yield* repository.loadProjectConfigOptional();
		const defaults = project?.openapi?.admin;
		const input = Option.getOrUndefined(config.input) ?? defaults?.input;
		const output = Option.getOrUndefined(config.output) ?? defaults?.output;
		const framework = Option.getOrUndefined(config.framework) ?? defaults?.framework;
		if (!input || !output || !framework) {
			return yield* Effect.fail(
				new Error(
					"admin generation requires --input, --output, and --framework (or matching openapi.admin defaults in .fizzyx.yaml)",
				),
			);
		}
		const result = yield* withSpinner(
			config.dryRun ? "Planning admin project" : "Generating admin project",
			generateAdminProject({
				input,
				output,
				framework,
				dryRun: config.dryRun,
				auth: defaults?.auth,
			}),
		);
		if (config.dryRun) {
			for (const command of result.commands) yield* Console.log(command.join(" "));
		}
		yield* logSuccess(
			`${config.dryRun ? "planned" : "generated"} ${result.framework} admin with ${result.resources} resource(s) at ${result.outputDir}`,
		);
		for (const diagnostic of result.diagnostics) yield* logInfo(`skipped: ${diagnostic}`);
		for (const conflict of result.conflicts) yield* logInfo(`conflict preserved: ${conflict}`);
	});

const openapiAdminCmd = Command.make(
	"admin",
	{
		input: Flag.optional(
			Flag.string("input").pipe(
				Flag.withAlias("i"),
				Flag.withDescription("OpenAPI spec URL or file path (or openapi.admin.input)"),
			),
		),
		output: Flag.optional(
			Flag.string("output").pipe(
				Flag.withAlias("o"),
				Flag.withDescription("New admin project directory (or openapi.admin.output)"),
			),
		),
		framework: Flag.optional(
			Flag.choice("framework", ["nextjs", "tanstack-start"] as const).pipe(
				Flag.withDescription("Application framework (or openapi.admin.framework)"),
			),
		),
		dryRun: Flag.boolean("dry-run").pipe(
			Flag.withDescription("Print Bun-first scaffold commands without writing a project"),
		),
	},
	handleAdmin,
).pipe(Command.withDescription("Generate a runnable shadcn admin app from an OpenAPI spec"));

export const openapiCmd = Command.make("openapi").pipe(
	Command.withDescription("Generate API client code from OpenAPI specs"),
	Command.withSubcommands([openapiGenerateCmd, openapiInitCmd, openapiListCmd, openapiAdminCmd]),
);
