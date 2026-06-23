import { Console, Effect } from "effect";
import { withSpinner } from "./spinner";
import { generateFromCli, writeManyFiles, listGenerators } from "../use-cases/openapi-service";
import { isHelpCommand, hasHelp } from "./_shared/help";
import { parseFlag, parseFlags } from "./_shared/parse";

export const runOpenapi = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(openapiUsage());
			return;
		}

		switch (command) {
			case "generate":
			case "g": {
				if (hasHelp(rest)) {
					yield* Console.log(openapiGenerateUsage());
					return;
				}

				const input = parseOpenapiGenerate(rest);

				const manyResult = yield* withSpinner(`Generating client...`, generateFromCli(input));

				yield* writeManyFiles(manyResult.results);
				for (const result of manyResult.results) {
					yield* Console.log(`generated ${result.files.length} file(s) to ${result.outputDir}`);
					yield* Console.log(
						`  endpoints: ${result.spec.endpoints.length}  types: ${Object.keys(result.spec.types).length}`,
					);
					if (result.run) {
						yield* runPostGenScript(result.run);
					}
				}
				return;
			}
			case "list": {
				const generators = listGenerators();
				if (generators.length === 0) {
					yield* Console.log("(no generators available)");
					return;
				}
				yield* Console.log("available generators:");
				for (const g of generators) {
					yield* Console.log(`  ${g.name}  ${g.description}`);
				}
				return;
			}
			case "help":
			case "--help":
			case "-h":
				yield* Console.log(openapiUsage());
				return;
			default:
				throw new Error(`unknown openapi command: ${command}\n\n${openapiUsage()}`);
		}
	});

interface OpenapiGenerateCli {
	inputs?: string[];
	outputs?: string[];
	client?: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	run?: string;
	headers?: Record<string, string>;
	stateManagement?: string;
}

const parseOpenapiGenerate = (args: ReadonlyArray<string>): OpenapiGenerateCli => {
	const inputs = parseFlags(args, "--input");
	const inputsShort = parseFlags(args, "-i");
	const allInputs = [...inputs, ...inputsShort];
	const outputs = parseFlags(args, "--output");
	const outputsShort = parseFlags(args, "-o");
	const allOutputs = [...outputs, ...outputsShort];
	const client = parseFlag(args, "--client") ?? parseFlag(args, "-c");
	const apiName = parseFlag(args, "--api-name");
	const typesNameRaw = parseFlag(args, "--types-name");
	const typesName = typesNameRaw === "false" ? false : typesNameRaw;
	const runtimeName = parseFlag(args, "--runtime-name");
	const run = parseFlag(args, "--run");
	const rawHeaders = parseFlags(args, "--header");
	const headers = parseRawHeaders(rawHeaders);
	const stateManagement = parseFlag(args, "--state-management");

	return {
		inputs: allInputs.length > 0 ? allInputs : undefined,
		outputs: allOutputs.length > 0 ? allOutputs : undefined,
		client,
		apiName,
		typesName,
		runtimeName,
		run,
		headers,
		stateManagement,
	};
};

const parseRawHeaders = (raw: string[]): Record<string, string> | undefined => {
	const headers: Record<string, string> = {};
	for (const item of raw) {
		const colon = item.indexOf(":");
		if (colon > 0) {
			const key = item.slice(0, colon).trim();
			const value = item.slice(colon + 1).trim();
			if (key && value) headers[key] = value;
		}
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
};

const runPostGenScript = (script: string): Effect.Effect<void, Error> =>
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
			const proc = Bun.spawnSync(cmd.split(" "), { stdio: ["inherit", "inherit", "inherit"] });
			if (proc.exitCode !== 0) {
				throw new Error(`"${cmd}" exited with code ${proc.exitCode}`);
			}
		},
		catch: (cause) =>
			new Error(
				`post-gen script failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			),
	});

const openapiUsage = (): string => `fizzyx openapi <command>

commands:
  generate (g)  Generate API client code from OpenAPI spec
  list          List available client generators

Use:
  fizzyx openapi generate -h
for generate help.`;

const openapiGenerateUsage = (): string => `fizzyx openapi generate (or g) [options]

Options:
  -i, --input <url|path>   OpenAPI spec URL or file path (repeatable for multiple inputs)
  -o, --output <dir|file>  Output directory (repeatable, positionally paired with --input)
  -c, --client <name>      Client target (wx)
  --api-name <name>        Generated API filename (default: api.ts)
  --types-name <name>      Types filename (default: types.ts, use 'false' to inline)
  --runtime-name <name>    Runtime filename (default: wx-request.ts)
  --run <script|cmd>       Run npm script or shell command after generation
                           (matches package.json scripts first, else raw command)
  --header <key:value>     Custom header for fetching spec (repeatable, e.g. --header "Authorization: Bearer xxx")
  --state-management <val> State management integration (e.g. tanstack-query)

If --input/--output/--client are omitted, all entries from .fizzy.yaml openapi are used.
If --output is also omitted, defaults to ./src/api.

Examples:
  fizzyx openapi g -i ./openapi.json -c wx
  fizzyx openapi g -i spec1.json -i spec2.json -o ./src/api -c wx
  fizzyx openapi generate -i ./openapi.json -o ./src/api -c wx
  fizzyx openapi generate -i ./openapi.json -o ./src/api/client.ts -c wx
  fizzyx openapi generate -i spec.yaml -o ./src/api -c wx --api-name sdk.ts --types-name false
  fizzyx openapi generate -i spec.json -o ./src/api -c wx --run check
  fizzyx openapi generate -i spec.json -o ./src/api -c wx --run "oxlint ."
  fizzyx openapi generate -i https://api.example.com/openapi.json -c fetch --header "Authorization: Bearer xxx" --header "X-Trace-Id: abc"`;
