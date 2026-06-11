import { Effect } from "effect";
import type { SetupProjectConfigInput } from "../ports/config-repository";
import {
	add,
	authLogin,
	authLogout,
	authStatus,
	block,
	done,
	makeFlowEnv,
	mine,
	next,
	resolveDoneRefFromGit,
	listBoards,
	setup,
	show,
	start,
	status,
	stepsFromDescription,
	syncBoard,
} from "../use-cases/flow-service";
import { printCardDetail, printCards, printSteps, renderTable } from "./render";
import { withSpinner } from "./spinner";

export const runCli = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;
		switch (command) {
			case "help":
			case "--help":
			case "-h":
				console.log(topUsage());
				return;
			case "setup": {
				if (hasHelp(rest)) {
					console.log(setupUsage());
					return;
				}

				const input = parseSetup(rest);
				if (input.list) {
					const boards = yield* withSpinner("Loading Fizzy boards...", listBoards());
					if (boards.length === 0) {
						console.log("(no boards)");
						return;
					}

					console.log(
						renderTable(boards, [
							{ header: "id", value: (board) => board.id },
							{ header: "name", value: (board) => board.name },
						]),
					);
					return;
				}

				const config = yield* withSpinner("Initializing Fizzy workflow...", setup(input));
				console.log(`created ${config.configPath}`);
				return;
			}
			case "auth":
				yield* runAuth(rest);
				return;
			case "flow":
				yield* runFlow(rest);
				return;
			default:
				throw new Error(legacyCommandErrorMessage(command));
		}
	});

const legacyFlowCommands = {
	sync: "sync",
	mine: "mine",
	status: "status",
	next: "next",
	show: "show",
	start: "start",
	done: "done",
	block: "block",
	add: "add",
	"steps-from-desc": "steps-from-desc",
} as const;

const legacyCommandErrorMessage = (command: string) => {
	const legacy = legacyFlowCommands[command as keyof typeof legacyFlowCommands];
	if (legacy) {
		return `unknown command: ${command}. Did you mean: fizzyx flow ${legacy}?`;
	}

	return `unknown command: ${command}\n\n${topUsage()}`;
};

const runFlow = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			console.log(flowUsage());
			return;
		}

		switch (command) {
			case "sync": {
				if (hasHelp(rest)) {
					console.log(flowSyncUsage());
					return;
				}
				const cache = yield* withSpinner(
					"Syncing Fizzy board...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* syncBoard(env);
					}),
				);
				console.error(`synced cards=${cache.cards.length} not_now=${cache.notNow.length}`);
				return;
			}
			case "mine": {
				if (hasHelp(rest)) {
					console.log(flowMineUsage());
					return;
				}
				const fresh = rest.includes("--fresh");
				const user = firstNonFlag(rest);
				const result = yield* withSpinner(
					"Loading my tasks...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* mine(env, { fresh, user });
					}),
				);
				console.log(`# ${result.name}: ${result.userId}`);
				console.log(printCards(result.cards));
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					console.log(flowStatusUsage());
					return;
				}
				const result = yield* withSpinner(
					"Loading board status...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* status(env, { fresh: rest.includes("--fresh") });
					}),
				);
				console.log(`# board cache age: ${result.age}s`);
				console.log("");
				console.log(
					printCards(
						result.cache.cards.filter((card) =>
							["INPROGRESS", "TODO"].includes(card.column?.name || ""),
						),
					),
				);
				if (result.cache.notNow.length > 0) {
					console.log(`\n# not_now (${result.cache.notNow.length})`);
					console.log(printCards(result.cache.notNow));
				}
				return;
			}
			case "next": {
				if (hasHelp(rest)) {
					console.log(flowNextUsage());
					return;
				}
				const result = yield* withSpinner(
					"Loading next task...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* next(env, { fresh: rest.includes("--fresh") });
					}),
				);
				if (!result.card) {
					console.log(`no TODO card for ${result.user.name}`);
					return;
				}
				console.log(`#${result.card.number} ${result.card.title}`);
				console.log(`next: fizzyx flow start ${result.card.number}`);
				return;
			}
			case "show": {
				if (hasHelp(rest)) {
					console.log(flowShowUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Loading card details...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* show(env, number);
					}),
				);
				console.log(printCardDetail(result.card, result.comments));
				return;
			}
			case "start": {
				if (hasHelp(rest)) {
					console.log(flowStartUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				yield* withSpinner(
					"Starting card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* start(env, number);
					}),
				);
				console.log(`started #${number}`);
				return;
			}
			case "done": {
				if (hasHelp(rest)) {
					console.log(flowDoneUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const explicitRef = rest
					.slice(1)
					.filter((arg) => !isHelpCommand(arg))
					.join(" ");
				const ref = explicitRef ? explicitRef : yield* resolveDoneRefFromGit();
				const result = yield* withSpinner(
					"Closing card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* done(env, number, ref);
					}),
				);
				console.log(`closed #${result.number} (${result.ref})`);
				return;
			}
			case "block": {
				if (hasHelp(rest)) {
					console.log(flowBlockUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const reason = rest.slice(1).join(" ");
				const result = yield* withSpinner(
					"Marking card blocked...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* block(env, number, reason);
					}),
				);
				console.log(`blocked #${result.number}: ${result.reason}`);
				return;
			}
			case "add": {
				if (hasHelp(rest)) {
					console.log(flowAddUsage());
					return;
				}
				const user = rest[0];
				const title = rest[1];
				const descPath = parseFlag(rest, "--desc");
				if (!user || !title || !descPath) {
					throw new Error(flowAddUsage());
				}
				const number = yield* withSpinner(
					"Creating card...",
					Effect.gen(function* () {
						const description = yield* readDescription(descPath);
						const env = yield* makeFlowEnv;
						return yield* add(env, { user, title, description });
					}),
				);
				console.log(number);
				return;
			}
			case "steps-from-desc": {
				if (hasHelp(rest)) {
					console.log(flowStepsUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const steps = yield* withSpinner(
					"Syncing Done When steps...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* stepsFromDescription(env, number);
					}),
				);
				console.log(printSteps(steps));
				return;
			}
			case "init": {
				if (hasHelp(rest)) {
					console.log(flowInitUsage());
					return;
				}
				const env = yield* withSpinner("Initializing workflow config...", makeFlowEnv);
				console.log(
					`flow configured with todo=${env.config.flow.columns.todo} in_progress=${env.config.flow.columns.inProgress}`,
				);
				return;
			}
			case "help":
			case "--help":
			case "-h":
				console.log(flowUsage());
				return;
			default:
				throw new Error(`unknown flow command: ${command}\n\n${flowUsage()}`);
		}
	});

const runAuth = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			console.log(authUsage());
			return;
		}

		switch (command) {
			case "login": {
				if (hasHelp(rest) || !rest[0]) {
					throw new Error(authLoginUsage());
				}
				const account = yield* withSpinner("Saving credentials...", authLogin(rest[0]));
				console.log(`token saved for ${account}`);
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					console.log(authStatusUsage());
					return;
				}
				const result = yield* withSpinner("Checking auth status...", authStatus);
				console.log(`account: ${result.account}`);
				console.log(`board: ${result.board}`);
				console.log(`authenticated: ${result.authenticated}`);
				if (result.identity) {
					console.log(`user: ${result.identity.name || ""}`);
					console.log(`user_id: ${result.identity.userId}`);
					console.log(`email: ${result.identity.email || ""}`);
				} else if (result.identityError) {
					console.log(`identity_error: ${result.identityError}`);
				}
				return;
			}
			case "logout": {
				if (hasHelp(rest)) {
					console.log(authLogoutUsage());
					return;
				}
				const account = yield* withSpinner("Clearing credentials...", authLogout);
				console.log(`token removed for ${account}`);
				return;
			}
			default:
				throw new Error(authUsage());
		}
	});

const parseSetup = (args: ReadonlyArray<string>): SetupProjectConfigInput => {
	const list = args.includes("--list");
	const flags = args.filter((arg) => arg.startsWith("--"));
	const positional = args.filter((arg) => !arg.startsWith("--"));

	if (list) {
		if (flags.length > 1 || positional.length > 0) {
			throw new Error("usage: fizzyx setup --list");
		}
		return { list: true };
	}

	if (flags.length > 0 || positional.length !== 1) {
		throw new Error("usage: fizzyx setup <board-id>");
	}

	return { board: positional[0] };
};

const parseNumber = (value: string | undefined): number => {
	const parsed = Number.parseInt((value || "").replace(/^#/, ""), 10);
	if (!Number.isFinite(parsed)) throw new Error("card number is required");
	return parsed;
};

const parseFlag = (args: ReadonlyArray<string>, name: string): string | undefined => {
	const index = args.indexOf(name);
	if (index < 0 || !args[index + 1]) {
		return undefined;
	}
	return args[index + 1];
};

const firstNonFlag = (args: ReadonlyArray<string>): string | undefined =>
	args.find((arg) => !arg.startsWith("--"));

const readDescription = (path: string) =>
	path === "-"
		? Effect.tryPromise({
				try: () => Bun.stdin.text(),
				catch: (cause) => new Error(`failed to read stdin: ${String(cause)}`),
			})
		: Effect.tryPromise({
				try: () => Bun.file(path).text(),
				catch: (cause) => new Error(`failed to read ${path}: ${String(cause)}`),
			});

const isHelpCommand = (value: string | undefined): value is "help" | "--help" | "-h" =>
	value === "help" || value === "--help" || value === "-h";

const hasHelp = (args: ReadonlyArray<string>): boolean => args.some(isHelpCommand);

const topUsage = (): string => `fizzyx <command>

commands:
  setup
  auth
  flow

Use:
  fizzyx <command> -h
for command help.`;

const setupUsage = (): string => `fizzyx setup <command>

commands:
  setup <board-id>
  setup --list`;

const authUsage = (): string => `fizzyx auth <command>

commands:
  auth login <token>
  auth status
  auth logout
  auth help`;

const flowUsage = (): string => `fizzyx flow <command>

commands:
   sync
   mine [--fresh] [user]
   status [--fresh]
   next [--fresh]
   show <card>
   start <card>
   done <card> [ref]
   block <card> <reason>
   add <user> <title> --desc <file|->
   steps-from-desc <card>
   init
   flow help`;

const flowSyncUsage = (): string => "fizzyx flow sync";
const flowMineUsage = (): string => "fizzyx flow mine [--fresh] [user]";
const flowStatusUsage = (): string => "fizzyx flow status [--fresh]";
const flowNextUsage = (): string => "fizzyx flow next [--fresh]";
const flowShowUsage = (): string => "fizzyx flow show <card>";
const flowStartUsage = (): string => "fizzyx flow start <card>";
const flowDoneUsage = (): string => "fizzyx flow done <card> [ref]";
const flowBlockUsage = (): string => "fizzyx flow block <card> <reason>";
const flowAddUsage = (): string => "fizzyx flow add <user> <title> --desc <file|->";
const flowStepsUsage = (): string => "fizzyx flow steps-from-desc <card>";
const flowInitUsage = (): string => "fizzyx flow init";

const authLoginUsage = (): string => "fizzyx auth login <token>";
const authStatusUsage = (): string => "fizzyx auth status";
const authLogoutUsage = (): string => "fizzyx auth logout";
