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
				const language = yield* withSpinner("Reading flow config...", loadFlowCardLanguage());
				console.log(flowSkill(language));
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

const flowSkill = (language: FlowCardLanguage): string => {
	if (language === "en") {
		return `## AGENTS.md snippet

- Use \`fizzyx flow workflow\` for process orientation.
- Use \`fizzyx flow template\` when creating new cards.
- Keep project process in local docs only when there are project-specific exceptions.
- Use \`flow.card.language\` in configuration to control comment labels (done/block/etc).`;
	}

	if (language === "mixed") {
		return `## AGENTS.md snippet

- 使用 \`fizzyx flow workflow\` 作为工作流程参考。
- 创建卡片时使用 \`fizzyx flow template\`。
- 仅在项目特殊场景下保留本地流程文档。
- 使用配置中的 \`flow.card.language\` 控制卡片动作注释语种。`;
	}

	return `## AGENTS.md 片段

- 使用 \`fizzyx flow workflow\` 作为工作流程参考。
- 创建卡片时使用 \`fizzyx flow template\`。
- 仅在项目特殊场景下保留本地流程文档。
- 使用配置中的 \`flow.card.language\` 控制卡片动作注释语种。`;
};

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
const flowAddUsage = (): string => "fizzyx flow add <user> <title> --desc <file|->";
const flowTemplateUsage = (): string => "fizzyx flow template";
const flowStepsUsage = (): string => "fizzyx flow steps-from-desc <card>";
const flowInitUsage = (): string => "fizzyx flow init";

const DEFAULT_CARD_LANGUAGE: FlowCardLanguage = DEFAULT_FLOW_CARD_LANGUAGE;

const flowTemplate = (language: FlowCardLanguage): string => {
	const labels = getTemplateLabels(language);

	return `## ${labels.goal}
Define the ticket objective in 1-2 concise sentences.

## ${labels.scope}
### ${labels.include}
- What should be included

### ${labels.exclude}
- What should not be included

## ${labels.notes}
- Keep changes small and deterministic
- Prefer existing patterns

## ${labels.files}
- Files to touch (relative path)

## ${labels.verification}
- Validation and acceptance checks to run before handoff

## Steps

- [ ] Replace goal + scope text with final content
- [ ] Add or update implementation files
- [ ] Keep step descriptions in plain text
- [ ] Confirm checks and close card`;
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
