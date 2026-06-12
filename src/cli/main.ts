import { Effect } from "effect";
import { DEFAULT_FLOW_CARD_LANGUAGE, type FlowCardLanguage } from "../domain/models";
import { makeBunConfigRepository } from "../adapters/bun-config-repository";
import type { SetupProjectConfigInput } from "../ports/config-repository";
import {
	add,
	authLogin,
	authLogout,
	authStatus,
	block,
	getStandardizedCommentTemplate,
	completeSteps,
	done,
	makeFlowEnv,
	mine,
	next,
	repairMarkdownDescription,
	resolveDoneRefFromGit,
	listBoards,
	setup,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
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
	"repair-markdown": "repair-markdown",
	"complete-steps": "complete-steps",
	"comment-template": "comment-template",
	"standardize-card": "standardize-card",
	"standardize-board": "standardize-board",
	std: "std",
	"std-all": "std-all",
	workflow: "workflow",
	skill: "skill",
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
			case "comment-template": {
				if (hasHelp(rest)) {
					console.log(flowCommentTemplateUsage());
					return;
				}
				const [kind] = rest;
				if (!isValidCommentTemplateKind(kind)) {
					throw new Error(flowCommentTemplateUsage());
				}
				const language = yield* withSpinner("Reading flow config...", loadFlowCardLanguage());
				console.log(getStandardizedCommentTemplate(language, kind));
				return;
			}
			case "workflow": {
				if (hasHelp(rest)) {
					console.log(flowWorkflowUsage());
					return;
				}
				const language = yield* withSpinner("Reading flow config...", loadFlowCardLanguage());
				console.log(flowWorkflow(language));
				return;
			}
			case "skill": {
				if (hasHelp(rest)) {
					console.log(flowSkillUsage());
					return;
				}
				console.log(flowSkill());
				return;
			}
			case "repair-markdown": {
				if (hasHelp(rest)) {
					console.log(flowRepairMarkdownUsage());
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
				console.log(`repaired #${repaired}`);
				return;
			}
			case "complete-steps": {
				if (hasHelp(rest)) {
					console.log(flowCompleteStepsUsage());
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
				console.log(`completed ${result.updatedCount} step${plural} for #${result.number}`);
				if (result.contents.length > 0) {
					console.log(result.contents.map((content) => `- ${content}`).join("\n"));
				}
				return;
			}
			case "std":
			case "standardize-card": {
				if (hasHelp(rest)) {
					console.log(flowStdUsage());
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
				console.log(formatStandardizeResult(result));
				return;
			}
			case "std-all":
			case "standardize-board": {
				if (hasHelp(rest)) {
					console.log(flowStdAllUsage());
					return;
				}
				const result = yield* withSpinner(
					"Standardizing board...",
					Effect.gen(function* () {
						const env = yield* makeFlowEnv;
						return yield* standardizeBoard(env);
					}),
				);
				console.log(result.results.map(formatStandardizeResult).join("\n"));
				console.log(
					`total=${result.total} descriptions=${result.descriptionUpdated} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`,
				);
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
			case "template": {
				if (hasHelp(rest)) {
					console.log(flowTemplateUsage());
					return;
				}
				const language = yield* withSpinner("Reading flow config...", loadFlowCardLanguage());
				console.log(flowTemplate(language));
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

const loadFlowCardLanguage = () => {
	const configRepo = makeBunConfigRepository();
	return configRepo.loadProjectConfigOptional().pipe(
		Effect.catchDefect(() => Effect.succeed(undefined)),
		Effect.catch(() => Effect.succeed(undefined)),
		Effect.map((projectConfig) => projectConfig?.flow?.card?.language || DEFAULT_CARD_LANGUAGE),
	);
};

const flowWorkflow = (language: FlowCardLanguage): string => {
	if (language === "en") {
		return `## Workflow

## Setup
- fizzyx setup <board-id>
- fizzyx auth login <token>
- fizzyx auth status

## Create
- fizzyx flow template > /tmp/card.md
- edit card content and steps in /tmp/card.md
- fizzyx flow add <user> "<title>" --desc /tmp/card.md

## Daily
- fizzyx flow mine --fresh
- fizzyx flow start <card>
- fizzyx flow show <card>

## Work
- Inspect task goal and constraints
- Draft clear implementation steps
- Implement changes
- Verify tests and acceptance criteria

## Complete
- fizzyx flow complete-steps <card>
- fizzyx flow done <card> "commit <sha>: <subject>"
- fizzyx flow done writes the standardized done comment and closes the card, so no separate close/comment step is needed.

## Block
- fizzyx flow block <card> "<reason>"
- Use \`fizzyx flow comment-template <kind>\` for manual comments, and keep comments concise.

## Card structure
- Description stores context
- Steps become Fizzy checklist items`;
	}

	if (language === "mixed") {
		return `## Workflow / 工作流

## Setup / 准备
- fizzyx setup <board-id>
- fizzyx auth login <token>
- fizzyx auth status

## Create / 创建
- fizzyx flow template > /tmp/card.md
- 编辑卡片描述和步骤后提交
- fizzyx flow add <user> "<title>" --desc /tmp/card.md

## Daily / 日常
- fizzyx flow mine --fresh
- fizzyx flow start <card>
- fizzyx flow show <card>

## Work / 进行中
- 明确目标与约束
- 复现并拆分实现步骤
- 执行变更
- 验收测试与自检

## Done / 完成
- fizzyx flow complete-steps <card>
- fizzyx flow done <card> "commit <sha>: <subject>"
- \`flow done\` 会写入标准完成评论并关闭卡片，无需额外进行 close/comment 操作。

## Block / 阻塞
- fizzyx flow block <card> "<reason>"
- 使用 \`fizzyx flow comment-template <kind>\` 进行手动注释，保持内容简洁。

## 卡片结构 / Card structure
- Description = 卡片背景与上下文
- Steps = 任务清单`;
	}

	return `## 工作流

## 准备
- fizzyx setup <board-id>
- fizzyx auth login <token>
- fizzyx auth status

## 创建
- fizzyx flow template > /tmp/card.md
- 编辑模板并补充内容
- fizzyx flow add <user> "<title>" --desc /tmp/card.md

## 每日
- fizzyx flow mine --fresh
- fizzyx flow start <card>
- fizzyx flow show <card>

## 任务执行
- 明确目标与约束
- 拆解实施步骤
- 执行变更
- 验证测试与验收

## 完成
- fizzyx flow complete-steps <card>
- fizzyx flow done <card> "commit <sha>: <subject>"
- \`flow done\` 会写入标准完成评论并关闭卡片，不要重复 close/comment。

## 阻塞
- fizzyx flow block <card> "<reason>"
- 使用 \`flow comment-template <kind>\` 进行手动评论并保持内容简洁。

## 卡片结构
- description 为上下文
- steps 会变成 Fizzy checklist`;
};

const flowSkill = (): string => `---
name: fizzyx
description: Manage this repository's board through fizzyx flow commands.
triggers:
  - fizzyx
  - /fizzyx
  - create card
  - close card
  - move card
  - assign card
  - add comment
  - add step
  - my cards
  - my tasks
  - board status
  - card workflow
invocable: true
argument-hint: "[flow action] [args...]"
---

# fizzyx

Use \`fizzyx flow ...\` for board workflow. Do not use the legacy official CLI
for project workflow. If \`fizzyx flow\` lacks an operation, stop and ask.

## Context Loading

- Treat this skill as generic. Do not hardcode board IDs, column IDs, users,
  scopes, title formats, or assignment rules here.
- Project data comes from \`.fizzy.yaml\`, the repo's \`AGENTS.md\`, and local
  workflow docs referenced by \`AGENTS.md\`.
- The CLI reads \`.fizzy.yaml\` automatically from the current repository.
- Before creating or assigning cards, inspect the project's local tracking rules
  instead of guessing from this skill.
- If project context is missing, run \`fizzyx setup <board-id>\` for machine
  config, then create or update a local project workflow doc such as
  \`docs/fizzy-workflow.md\` and link it from \`AGENTS.md\`.

## Project Workflow Doc

Keep project-specific board details out of this skill. Put them in a local doc
near the repo's other docs, usually \`docs/fizzy-workflow.md\`.

Minimum sections:

- Install/auth/setup commands.
- Board/account/API/cache context.
- Column meanings and IDs.
- Card title formats and allowed scopes.
- Assignment rules and user IDs.
- Local delivery rules that differ from \`fizzyx flow workflow\`.

If any of these facts are unknown, ask before creating cards that depend on
them.

## Identity

- \`my work\`, \`my cards\`, and \`my tasks\` mean the authenticated fizzyx user.
- Do not infer identity from git user, OS user, commit author, branch, or card assignee.
- For identity-sensitive requests, run \`fizzyx auth status\` first.
- Then run \`fizzyx flow mine --fresh\`.
- Use \`fizzyx flow status --fresh\` only as extra board context.

## Commands

\`\`\`bash
fizzyx auth status
fizzyx flow workflow
fizzyx flow status --fresh
fizzyx flow mine --fresh
fizzyx flow show <card>
fizzyx flow start <card>
fizzyx flow template
fizzyx flow add <user> "<title>" --desc <file|->
fizzyx flow comment-template <done|blocked|unblocked|handoff|note>
fizzyx flow complete-steps <card>
fizzyx flow done <card> "commit <sha>: <subject>"
fizzyx flow block <card> "<reason>"
fizzyx flow std <card>
fizzyx flow std-all
\`\`\`

## Cards

- Generate new card bodies with \`fizzyx flow template\`.
- Description is context only. Field language follows \`flow.card.language\`.
- Put work checklist under \`## Steps\`; \`flow add\` converts it to card steps.
- Step labels must be plain text: no Markdown links, backticks, or bold.
- Normalize existing cards with \`fizzyx flow std <card>\`.

## Delivery

- Do not create cards for typo fixes or tiny chore commits.
- Do not maintain a parallel progress document; board is execution state.
- Before closing, run \`fizzyx flow complete-steps <card>\`.
- Close with \`fizzyx flow done <card> "commit <sha>: <subject>"\`.
- Keep comments concise; use \`fizzyx flow comment-template <kind>\` for format.`;

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
    comment-template <kind>
    workflow
    skill
    repair-markdown <card>
    complete-steps <card>
    std <card>
    std-all
    add <user> <title> --desc <file|->
    template
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
const flowRepairMarkdownUsage = (): string => "fizzyx flow repair-markdown <card>";
const flowCommentTemplateUsage = (): string => "fizzyx flow comment-template <kind>";
const flowWorkflowUsage = (): string => "fizzyx flow workflow";
const flowSkillUsage = (): string => "fizzyx flow skill";
const flowCompleteStepsUsage = (): string => "fizzyx flow complete-steps <card>";
const flowStdUsage = (): string => "fizzyx flow std <card>  (alias: standardize-card)";
const flowStdAllUsage = (): string => "fizzyx flow std-all  (alias: standardize-board)";
const flowAddUsage = (): string => "fizzyx flow add <user> <title> --desc <file|->";
const flowTemplateUsage = (): string => "fizzyx flow template";
const flowStepsUsage = (): string => "fizzyx flow steps-from-desc <card>";
const flowInitUsage = (): string => "fizzyx flow init";

const DEFAULT_CARD_LANGUAGE: FlowCardLanguage = DEFAULT_FLOW_CARD_LANGUAGE;

const flowTemplate = (language: FlowCardLanguage): string => {
	const labels = getTemplateLabels(language);
	const text = getTemplateText(language);

	return `## ${labels.goal}
${text.goal}

## ${labels.scope}
### ${labels.include}
- ${text.include}

### ${labels.exclude}
- ${text.exclude}

## ${labels.notes}
- ${text.noteSmall}
- ${text.notePattern}

## ${labels.files}
- ${text.files}

## ${labels.verification}
- ${text.verification}

## Steps

- [ ] ${text.stepGoal}
- [ ] ${text.stepImplementation}
- [ ] ${text.stepPlain}
- [ ] ${text.stepClose}`;
};

const getTemplateText = (language: FlowCardLanguage) => {
	if (language === "en") {
		return {
			goal: "Define the ticket objective in 1-2 concise sentences.",
			include: "What should be included",
			exclude: "What should not be included",
			noteSmall: "Keep changes small and deterministic",
			notePattern: "Prefer existing patterns",
			files: "Files to touch (relative path)",
			verification: "Validation and acceptance checks to run before handoff",
			stepGoal: "Replace goal + scope text with final content",
			stepImplementation: "Add or update implementation files",
			stepPlain: "Keep step descriptions in plain text",
			stepClose: "Confirm checks and close card",
		};
	}

	if (language === "mixed") {
		return {
			goal: "用 1-2 句说明目标；代码/API 名称可保留英文。",
			include: "In scope / 本卡包含的工作",
			exclude: "Out of scope / 本卡不包含的工作",
			noteSmall: "Keep changes small / 保持变更小且确定",
			notePattern: "Prefer existing patterns / 优先沿用现有模式",
			files: "Files to touch / 相关文件路径",
			verification: "Checks to run / 需要执行的验证",
			stepGoal: "Finalize goal and scope / 确认目标与范围",
			stepImplementation: "Implement required changes / 完成实现",
			stepPlain: "Keep step labels plain text / step 文本不写 Markdown",
			stepClose: "Run checks and close card / 通过检查并关卡",
		};
	}

	return {
		goal: "用 1-2 句说明这张卡要完成什么、为什么。",
		include: "本卡包含的工作",
		exclude: "本卡不包含的工作",
		noteSmall: "保持变更小且确定",
		notePattern: "优先沿用现有模式",
		files: "相关文件路径",
		verification: "交付前需要执行的检查或验收",
		stepGoal: "确认目标与范围",
		stepImplementation: "完成实现文件变更",
		stepPlain: "保持 step 文本为纯文本",
		stepClose: "检查通过并关闭卡片",
	};
};

const getTemplateLabels = (language: FlowCardLanguage) => {
	if (language === "en") {
		return {
			scope: "Scope",
			goal: "Goal",
			include: "In",
			exclude: "Out",
			files: "Files",
			verification: "Verification",
			notes: "Notes",
		};
	}

	if (language === "mixed") {
		return {
			scope: "Scope / 范围",
			goal: "Goal / 目标",
			include: "In / 包含",
			exclude: "Out / 不包含",
			files: "Files / 文件",
			verification: "Verification / 验证",
			notes: "Notes / 备注",
		};
	}

	return {
		scope: "范围",
		goal: "目标",
		include: "包含",
		exclude: "不包含",
		files: "文件",
		verification: "验证",
		notes: "备注",
	};
};

const authLoginUsage = (): string => "fizzyx auth login <token>";
const authStatusUsage = (): string => "fizzyx auth status";
const authLogoutUsage = (): string => "fizzyx auth logout";
