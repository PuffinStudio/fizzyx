import { Console, Effect } from "effect";
import { withSpinner } from "./spinner";
import { printCardDetail, printCards, printSteps } from "./render";
import {
	formatFlowScaffoldResult,
	createFlowDraft,
	initFlowScaffold,
	loadFlowSkillContent,
	loadFlowTemplateContent,
	loadFlowWorkflowContent,
} from "./flow-content";
import {
	add,
	assign,
	block,
	doctor,
	getStandardizedCommentTemplate,
	completeSteps,
	done,
	makeFlowEnv,
	mine,
	next,
	repairMarkdownDescription,
	resolveDoneRefFromGit,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
	syncBoard,
} from "../use-cases/flow-service";
import { isHelpCommand, hasHelp } from "./_shared/help";
import { parseFlag, firstNonFlag, parseNumber } from "./_shared/parse";

export const runFlow = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(flowUsage());
			return;
		}

		switch (command) {
			case "sync": {
				if (hasHelp(rest)) {
					yield* Console.log(flowSyncUsage());
					return;
				}
				const cache = yield* withSpinner(
					"Syncing Fizzy board...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* syncBoard(env);
					}),
				);
				yield* Console.log(`synced cards=${cache.cards.length} not_now=${cache.notNow.length}`);
				return;
			}
			case "mine": {
				if (hasHelp(rest)) {
					yield* Console.log(flowMineUsage());
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
				yield* Console.log(`# ${result.name}: ${result.userId}`);
				yield* Console.log(printCards(result.cards));
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStatusUsage());
					return;
				}
				const result = yield* withSpinner(
					"Loading board status...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						const result = yield* status(env, { fresh: rest.includes("--fresh") });
						return { env, result };
					}),
				);
				yield* Console.log(`# board cache age: ${result.result.age}s`);
				yield* Console.log("");
				const activeColumnIds = new Set([
					result.env.config.flow.columns.inProgress,
					result.env.config.flow.columns.todo,
				]);
				yield* Console.log(
					printCards(
						result.result.cache.cards.filter((card) => activeColumnIds.has(card.column?.id || "")),
					),
				);
				if (result.result.cache.notNow.length > 0) {
					yield* Console.log(`\n# not_now (${result.result.cache.notNow.length})`);
					yield* Console.log(printCards(result.result.cache.notNow));
				}
				return;
			}
			case "next": {
				if (hasHelp(rest)) {
					yield* Console.log(flowNextUsage());
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
					yield* Console.log(`no TODO card for ${result.user.name}`);
					return;
				}
				yield* Console.log(`#${result.card.number} ${result.card.title}`);
				yield* Console.log(`next: fizzyx flow start ${result.card.number}`);
				return;
			}
			case "show": {
				if (hasHelp(rest)) {
					yield* Console.log(flowShowUsage());
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
				yield* Console.log(printCardDetail(result.card, result.comments));
				return;
			}
			case "start": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStartUsage());
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
				yield* Console.log(`started #${number}`);
				return;
			}
			case "done": {
				if (hasHelp(rest)) {
					yield* Console.log(flowDoneUsage());
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
				yield* Console.log(`closed #${result.number} (${result.ref})`);
				return;
			}
			case "block": {
				if (hasHelp(rest)) {
					yield* Console.log(flowBlockUsage());
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
				yield* Console.log(`blocked #${result.number}: ${result.reason}`);
				return;
			}
			case "assign": {
				if (hasHelp(rest)) {
					yield* Console.log(flowAssignUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const users = rest.slice(1).filter((a) => !a.startsWith("--"));
				if (users.length === 0) {
					throw new Error(flowAssignUsage());
				}
				const result = yield* withSpinner(
					"Assigning card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* assign(env, number, users);
					}),
				);
				yield* Console.log(`assigned #${result.number} to ${result.userIds.join(", ")}`);
				return;
			}
			case "comment-template": {
				if (hasHelp(rest)) {
					yield* Console.log(flowCommentTemplateUsage());
					return;
				}
				const [kind] = rest;
				if (!isValidCommentTemplateKind(kind)) {
					throw new Error(flowCommentTemplateUsage());
				}
				yield* Console.log(getStandardizedCommentTemplate(kind));
				return;
			}
			case "workflow": {
				if (hasHelp(rest)) {
					yield* Console.log(flowWorkflowUsage());
					return;
				}
				yield* Console.log(
					yield* withSpinner("Reading local workflow template...", loadFlowWorkflowContent()),
				);
				return;
			}
			case "skill": {
				const [subcommand, ...skillRest] = rest;

				if (subcommand === "init") {
					if (hasHelp(skillRest)) {
						yield* Console.log(flowSkillInitUsage());
						return;
					}

					for (const arg of skillRest) {
						if (arg !== "--force") {
							throw new Error(flowSkillInitUsage());
						}
					}

					const force = skillRest.includes("--force");
					const results = yield* withSpinner(
						"Writing flow skill scaffold...",
						initFlowScaffold({ force }),
					);
					for (const result of results) {
						yield* Console.log(formatFlowScaffoldResult(result));
					}
					return;
				}

				if (hasHelp(rest)) {
					yield* Console.log(flowSkillUsage());
					return;
				}

				if (subcommand !== undefined) {
					throw new Error(flowSkillUsage());
				}

				const skill = yield* withSpinner("Reading local skill file...", loadFlowSkillContent());
				yield* Console.log(skill);
				return;
			}
			case "repair-markdown": {
				if (hasHelp(rest)) {
					yield* Console.log(flowRepairMarkdownUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const repaired = yield* withSpinner(
					"Repairing card description...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* repairMarkdownDescription(env, number);
					}),
				);
				yield* Console.log(`repaired #${repaired}`);
				return;
			}
			case "complete-steps": {
				if (hasHelp(rest)) {
					yield* Console.log(flowCompleteStepsUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Completing pending steps...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* completeSteps(env, number);
					}),
				);
				const plural = result.updatedCount === 1 ? "" : "s";
				yield* Console.log(`completed ${result.updatedCount} step${plural} for #${result.number}`);
				if (result.contents.length > 0) {
					yield* Console.log(result.contents.map((content) => `- ${content}`).join("\n"));
				}
				return;
			}
			case "std":
			case "standardize-card": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStdUsage());
					return;
				}
				const number = parseNumber(rest[0]);
				const result = yield* withSpinner(
					"Standardizing card...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* standardizeCard(env, number);
					}),
				);
				yield* Console.log(formatStandardizeResult(result));
				return;
			}
			case "std-all":
			case "standardize-board": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStdAllUsage());
					return;
				}
				const result = yield* withSpinner(
					"Standardizing board...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* standardizeBoard(env);
					}),
				);
				yield* Console.log(result.results.map(formatStandardizeResult).join("\n"));
				yield* Console.log(
					`total=${result.total} descriptions=${result.descriptionUpdated} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`,
				);
				return;
			}
			case "add": {
				if (hasHelp(rest)) {
					yield* Console.log(flowAddUsage());
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
				yield* Console.log(number);
				return;
			}
			case "steps-from-desc": {
				if (hasHelp(rest)) {
					yield* Console.log(flowStepsUsage());
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
				yield* Console.log(printSteps(steps));
				return;
			}
			case "template": {
				if (hasHelp(rest)) {
					yield* Console.log(flowTemplateUsage());
					return;
				}
				if (rest.includes("--draft")) {
					const draft = yield* withSpinner("Writing card draft...", createFlowDraft());
					yield* Console.log(draft.path);
					return;
				}
				yield* Console.log(
					yield* withSpinner("Reading local card template...", loadFlowTemplateContent()),
				);
				return;
			}
			case "doctor": {
				if (hasHelp(rest)) {
					yield* Console.log(flowDoctorUsage());
					return;
				}
				const result = yield* withSpinner(
					"Checking flow health...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* doctor(env);
					}),
				);
				const lines: string[] = [];
				lines.push("=== Board Health ===");
				lines.push(`account: ${result.account}`);
				lines.push(`board: ${result.boardId}`);
				lines.push(`api: ${result.apiUrl}`);
				lines.push("");
				lines.push("API-visible columns:");
				for (const col of result.allColumns) {
					const isExpected = result.columns.some((c) => c.id === col.id);
					const status = isExpected ? "✓" : "•";
					lines.push(`  ${status} ${col.name} (${col.id})`);
				}
				lines.push("");
				lines.push("Implicit system actions:");
				for (const action of result.systemActions) {
					lines.push(`  ✓ ${action.name} via ${action.via} (not listed by columns API)`);
				}
				if (result.info.length > 0) {
					lines.push("");
					for (const msg of result.info) {
						lines.push(`  i ${msg}`);
					}
				}
				if (result.fixes.length > 0) {
					lines.push("\nFixes:");
					for (const fix of result.fixes) {
						lines.push(`  • ${fix}`);
					}
				} else {
					lines.push("\nAll good!");
				}
				yield* Console.log(lines.join("\n"));
				return;
			}
			case "init": {
				if (hasHelp(rest)) {
					yield* Console.log(flowInitUsage());
					return;
				}
				const env = yield* withSpinner("Initializing workflow config...", makeFlowEnv);
				yield* Console.log(
					`flow configured: todo=${env.config.flow.columns.todo} in_progress=${env.config.flow.columns.inProgress}`,
				);
				return;
			}
			case "help":
			case "--help":
			case "-h":
				yield* Console.log(flowUsage());
				return;
			default:
				throw new Error(`unknown flow command: ${command}\n\n${flowUsage()}`);
		}
	});

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
    comment-template <kind>
    workflow
    skill
    repair-markdown <card>
    complete-steps <card>
    std <card>
    std-all
    add <user> <title> --desc <file|->
    assign <card> <user|me> [user...]
    template [--draft]
    steps-from-desc <card>
    init
    doctor
    flow help`;

const flowSyncUsage = (): string => "fizzyx flow sync";
const flowMineUsage = (): string => "fizzyx flow mine [--fresh] [user]";
const flowStatusUsage = (): string => "fizzyx flow status [--fresh]";
const flowNextUsage = (): string => "fizzyx flow next [--fresh]";
const flowShowUsage = (): string => "fizzyx flow show <card>";
const flowStartUsage = (): string => "fizzyx flow start <card>";
const flowDoneUsage = (): string => "fizzyx flow done <card> [ref]";
const flowBlockUsage = (): string => "fizzyx flow block <card> <reason>";
const flowRepairMarkdownUsage = (): string => "fizzyx flow repair-markdown <card>";
const flowCommentTemplateUsage = (): string => "fizzyx flow comment-template <kind>";
const flowWorkflowUsage = (): string => "fizzyx flow workflow";
const flowSkillUsage = (): string => "fizzyx flow skill";
const flowSkillInitUsage = (): string => "fizzyx flow skill init [--force]";
const flowCompleteStepsUsage = (): string => "fizzyx flow complete-steps <card>";
const flowStdUsage = (): string => "fizzyx flow std <card>  (alias: standardize-card)";
const flowStdAllUsage = (): string => "fizzyx flow std-all  (alias: standardize-board)";
const flowAddUsage = (): string => "fizzyx flow add <user> <title> --desc <file|->";
const flowAssignUsage = (): string => "fizzyx flow assign <card> <user|me> [user...]";
const flowTemplateUsage = (): string => "fizzyx flow template [--draft]";
const flowStepsUsage = (): string => "fizzyx flow steps-from-desc <card>";
const flowInitUsage = (): string => "fizzyx flow init";
const flowDoctorUsage = (): string => "fizzyx flow doctor";

const formatStandardizeResult = (result: {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}): string =>
	`standardized #${result.number} description=${result.descriptionUpdated ? "yes" : "no"} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

type FlowCommentTemplateKind = "done" | "blocked" | "unblocked" | "handoff" | "note";

const isValidCommentTemplateKind = (value: string | undefined): value is FlowCommentTemplateKind =>
	value === "done" ||
	value === "blocked" ||
	value === "unblocked" ||
	value === "handoff" ||
	value === "note";

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
