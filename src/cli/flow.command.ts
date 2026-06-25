import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { printCardDetail, printCards, printSteps } from "./render";
import { runWithFlowEnv, runWithFlowRuntimeEnv } from "./flow-workflow";
import {
	formatDoctorResult,
	formatSyncingFizzyBoardMessage,
	formatLoadingMyTasksMessage,
	formatLoadingBoardStatusMessage,
	formatLoadingNextTaskMessage,
	formatLoadingCardDetailsMessage,
	formatStartingCardMessage,
	formatMovingCardToReadyMessage,
	formatMovingCardToReviewMessage,
	formatClosingCardMessage,
	formatBlockingCardMessage,
	formatAssigningCardMessage,
	formatReadingWorkflowTemplateMessage,
	formatWritingSkillScaffoldMessage,
	formatReadingSkillFileMessage,
	formatRepairingDescriptionMessage,
	formatCompletingStepsMessage,
	formatStandardizingCardMessage,
	formatStandardizingBoardMessage,
	formatCreatingCardMessage,
	formatSyncingDoneWhenStepsMessage,
	formatWritingCardDraftMessage,
	formatReadingCardTemplateMessage,
	formatCheckingFlowHealthMessage,
	formatInitializingWorkflowConfigMessage,
	formatFlowConfigured,
	formatFlowConfigMissing,
	formatFlowStatusHeader,
	formatAddedCard,
	formatNotNowSection,
	formatNextSummary,
	formatNextAutoStartSummary,
	formatNextActionHint,
	formatCommentTemplate,
	formatAddUsage,
	formatSyncResult,
	formatCompleteStepsSummary,
	formatStandardizeBoardSummary,
	formatMineHeader,
	formatNoTodoCard,
	formatBlankLine,
	formatRepairedCard,
	formatBlockedCard,
	formatStartedCard,
	formatMovedCard,
	formatClosedCard,
	formatSkillTemplate,
	formatAssignedCard,
	formatCompletedSteps,
	formatFlowTemplateDraftPath,
	formatFlowTemplateContent,
	formatWorkflowTemplate,
	formatStandardizeBoardResults,
	formatStandardizeResult,
} from "./flow-output";
import {
	formatFlowScaffoldResult,
	createFlowDraft,
	initFlowScaffold,
	loadFlowSkillContent,
	loadFlowTemplateContent,
	loadFlowWorkflowContent,
} from "./flow-content";
import {
	bootstrapFlowConfig,
	add,
	assign,
	block,
	analyzeDoctor,
	repairDoctor,
	getStandardizedCommentTemplate,
	completeSteps,
	done,
	mine,
	repairMarkdownDescription,
	ready,
	nextOrStart,
	resolveDoneRefFromGit,
	review,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
	syncBoard,
} from "../use-cases/flow-service";
import { withSpinner, logSuccess } from "./ui";
import { readDescription } from "./flow-input";
import { formatCheckingPlannerHealthMessage, formatPlannerHealthResult } from "./planner-output";
import { loadPlannerSnapshot } from "../use-cases/planner-service";

const handleSync = (): Effect.Effect<void, any, any> =>
	runWithFlowEnv(formatSyncingFizzyBoardMessage(), (env) => syncBoard(env)).pipe(
		Effect.flatMap((cache) =>
			logSuccess(formatSyncResult(cache.cards.length, cache.notNow.length)),
		),
	);

const handleMine = (config: {
	fresh: boolean;
	user: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const resolvedUser = Option.isSome(config.user) ? config.user.value : undefined;
		const result = yield* runWithFlowEnv(formatLoadingMyTasksMessage(), (env) =>
			mine(env, {
				fresh: config.fresh,
				user: resolvedUser,
			}),
		);
		yield* Console.log(formatMineHeader(result.name, result.userId));
		if (result.cards.length > 0) {
			yield* Console.log(formatNextActionHint(result.cards[0]!.number));
		}
		yield* Console.log(printCards(result.cards));
	});

const handleFlowStatus = (config: { fresh: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatLoadingBoardStatusMessage(), (env) =>
			Effect.gen(function* () {
				const statusResult = yield* status(env, { fresh: config.fresh });
				return { env, result: statusResult };
			}),
		);
		yield* Console.log(formatFlowStatusHeader(result.result.age));
		yield* Console.log(formatBlankLine());
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
			yield* Console.log(formatNotNowSection(result.result.cache.notNow.length));
			yield* Console.log(printCards(result.result.cache.notNow));
		}
	});

const handleNext = (config: { fresh: boolean; start: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatLoadingNextTaskMessage(), (env) =>
			nextOrStart(env, { fresh: config.fresh, autoStart: config.start }),
		);
		if (!result.card) {
			yield* Console.log(formatNoTodoCard(result.user.name));
			return;
		}
		if (config.start) {
			yield* logSuccess(formatStartedCard(result.card.number));
			yield* Console.log(formatNextAutoStartSummary(result.card.number));
			return;
		}
		yield* Console.log(formatNextSummary(result.card.number, result.card.title));
		yield* Console.log(formatNextActionHint(result.card.number));
	});

const handleShow = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv(formatLoadingCardDetailsMessage(), (env) =>
			show(env, config.card),
		);
		yield* Console.log(printCardDetail(result.card, result.comments));
	});

const handleStart = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* runWithFlowEnv(formatStartingCardMessage(), (env) => start(env, config.card));
		yield* logSuccess(formatStartedCard(config.card));
	});

const handleReady = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatMovingCardToReadyMessage(), (env) =>
			ready(env, config.card),
		);
		yield* logSuccess(formatMovedCard(result.number, result.column));
	});

const handleReview = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatMovingCardToReviewMessage(), (env) =>
			review(env, config.card),
		);
		yield* logSuccess(formatMovedCard(result.number, result.column));
	});

const handleDone = (config: {
	card: number;
	ref: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const explicitRef = Option.isSome(config.ref) ? config.ref.value : undefined;
		const resolvedRef = explicitRef ?? (yield* resolveDoneRefFromGit());
		const result = yield* runWithFlowEnv(formatClosingCardMessage(), (env) =>
			done(env, config.card, resolvedRef),
		);
		yield* logSuccess(formatClosedCard(result.number, result.ref));
	});

const handleBlock = (config: { card: number; reason: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatBlockingCardMessage(), (env) =>
			block(env, config.card, config.reason),
		);
		yield* Console.log(formatBlockedCard(result.number, result.reason));
	});

const handleAssign = (config: {
	card: number;
	users: ReadonlyArray<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatAssigningCardMessage(), (env) =>
			assign(env, config.card, config.users as string[]),
		);
		yield* logSuccess(formatAssignedCard(result.number, result.userIds.join(", ")));
	});

const handleCommentTemplate = (config: {
	kind: "done" | "blocked" | "unblocked" | "handoff" | "note";
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log(formatCommentTemplate(getStandardizedCommentTemplate(config.kind)));
	});

const handleWorkflow = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const workflow = yield* withSpinner(
			formatReadingWorkflowTemplateMessage(),
			loadFlowWorkflowContent(),
		);
		yield* Console.log(formatWorkflowTemplate(workflow));
	});

const handleHealth = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log("`fizzyx flow health` is deprecated. Use `fizzyx planner health` instead.");
		const snapshot = yield* withSpinner(
			formatCheckingPlannerHealthMessage(),
			loadPlannerSnapshot(),
		);
		yield* Console.log(formatPlannerHealthResult(snapshot));
	});

const handleSkillInit = (config: { force: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const results = yield* withSpinner(
			formatWritingSkillScaffoldMessage(),
			initFlowScaffold({ force: config.force }),
		);
		for (const result of results) {
			yield* Console.log(formatFlowScaffoldResult(result));
		}
	});

const handleSkill = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const skill = yield* withSpinner(formatReadingSkillFileMessage(), loadFlowSkillContent());
		yield* Console.log(formatSkillTemplate(skill));
	});

const handleRepairMarkdown = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const repaired = yield* runWithFlowEnv(formatRepairingDescriptionMessage(), (env) =>
			repairMarkdownDescription(env, config.card),
		);
		yield* logSuccess(formatRepairedCard(repaired));
	});

const handleCompleteSteps = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatCompletingStepsMessage(), (env) =>
			completeSteps(env, config.card),
		);
		yield* logSuccess(formatCompleteStepsSummary(result.updatedCount, result.number));
		if (result.contents.length > 0) {
			yield* Console.log(formatCompletedSteps(result.contents));
		}
	});

const handleStd = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatStandardizingCardMessage(), (env) =>
			standardizeCard(env, config.card),
		);
		yield* Console.log(formatStandardizeResult(result));
	});

const handleStdAll = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatStandardizingBoardMessage(), (env) =>
			standardizeBoard(env),
		);
		yield* Console.log(formatStandardizeBoardResults(result.results));
		yield* Console.log(formatStandardizeBoardSummary(result));
	});

const handleAdd = (config: {
	user: string;
	title: string;
	desc?: string;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (!config.desc) {
			yield* Console.log(formatAddUsage());
			return;
		}
		const number = yield* runWithFlowEnv(formatCreatingCardMessage(), (env) =>
			Effect.gen(function* () {
				const description = yield* readDescription(config.desc!);
				return yield* add(env, {
					user: config.user,
					title: config.title,
					description,
				});
			}),
		);
		yield* Console.log(formatAddedCard(number));
	});

const handleStepsFromDesc = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const steps = yield* runWithFlowEnv(formatSyncingDoneWhenStepsMessage(), (env) =>
			stepsFromDescription(env, config.card),
		);
		yield* Console.log(printSteps(steps));
	});

const handleFlowTemplate = (config: { draft: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.draft) {
			const draftResult = yield* withSpinner(formatWritingCardDraftMessage(), createFlowDraft());
			yield* Console.log(formatFlowTemplateDraftPath(draftResult.path));
			return;
		}
		const template = yield* withSpinner(
			formatReadingCardTemplateMessage(),
			loadFlowTemplateContent(),
		);
		yield* Console.log(formatFlowTemplateContent(template));
	});

const handleDoctor = (config: { apply: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv(
			formatCheckingFlowHealthMessage(),
			config.apply ? repairDoctor : analyzeDoctor,
		);
		yield* Console.log(formatDoctorResult(result, { applied: config.apply }));
	});

const handleFlowInit = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const { hadMissingConfig, initializedConfig } = yield* runWithFlowRuntimeEnv(
			formatInitializingWorkflowConfigMessage(),
			(env) =>
				Effect.gen(function* () {
					const hadMissingConfig = !env.config.flow;
					return {
						hadMissingConfig,
						initializedConfig: yield* bootstrapFlowConfig(env, {
							repairWorkflowColumns: hadMissingConfig,
						}),
					};
				}),
		);
		if (hadMissingConfig) {
			yield* Console.log(formatFlowConfigMissing());
		}
		yield* Console.log(
			formatFlowConfigured(
				initializedConfig.flow.columns.todo,
				initializedConfig.flow.columns.inProgress,
			),
		);
	});

const flowSyncCmd = Command.make("sync", {}, handleSync).pipe(
	Command.withDescription("Sync Fizzy board cache"),
);

const flowMineCmd = Command.make(
	"mine",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to filter"),
			Argument.optional,
		),
	},
	handleMine,
).pipe(Command.withDescription("List my tasks"));

const flowStatusCmd = Command.make(
	"status",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
	},
	handleFlowStatus,
).pipe(Command.withDescription("Show board status"));

const flowNextCmd = Command.make(
	"next",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
		start: Flag.boolean("start").pipe(
			Flag.withDescription("Start the recommended card immediately"),
		),
	},
	handleNext,
).pipe(Command.withDescription("Show next TODO card or start it directly"));

const flowShowCmd = Command.make(
	"show",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleShow,
).pipe(Command.withDescription("Show card details"));

const flowStartCmd = Command.make(
	"start",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStart,
).pipe(Command.withDescription("Start a card"));

const flowReadyCmd = Command.make(
	"ready",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleReady,
).pipe(Command.withDescription("Move a card to READY"));

const flowReviewCmd = Command.make(
	"review",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleReview,
).pipe(Command.withDescription("Move a card to REVIEW"));

const flowDoneCmd = Command.make(
	"done",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		ref: Argument.string("ref").pipe(
			Argument.withDescription("Commit reference (SHA or message)"),
			Argument.optional,
		),
	},
	handleDone,
).pipe(Command.withDescription("Close a card"));

const flowBlockCmd = Command.make(
	"block",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		reason: Argument.string("reason").pipe(
			Argument.withMetavar("REASON"),
			Argument.withDescription("Block reason"),
		),
	},
	handleBlock,
).pipe(Command.withDescription("Block a card"));

const flowAssignCmd = Command.make(
	"assign",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		users: Argument.string("user").pipe(
			Argument.withMetavar("USER"),
			Argument.withDescription("User(s) to assign (use 'me' for self)"),
			Argument.variadic({ min: 1 }),
		),
	},
	handleAssign,
).pipe(Command.withDescription("Assign card to user(s)"));

const flowCommentTemplateCmd = Command.make(
	"comment-template",
	{
		kind: Argument.choice("kind", [
			"done",
			"blocked",
			"unblocked",
			"handoff",
			"note",
		] as const).pipe(Argument.withDescription("Template kind")),
	},
	handleCommentTemplate,
).pipe(Command.withDescription("Print standardized comment template"));

const flowWorkflowCmd = Command.make("workflow", {}, handleWorkflow).pipe(
	Command.withDescription("Print workflow process checklist"),
);

const flowSkillInitCmd = Command.make(
	"init",
	{
		force: Flag.boolean("force").pipe(Flag.withDescription("Overwrite existing files")),
	},
	handleSkillInit,
).pipe(Command.withDescription("Initialize flow skill scaffold"));

const flowSkillCmd = Command.make("skill", {}, handleSkill).pipe(
	Command.withDescription("Read or initialize flow skill"),
	Command.withSubcommands([flowSkillInitCmd]),
);

const flowRepairMarkdownCmd = Command.make(
	"repair-markdown",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleRepairMarkdown,
).pipe(Command.withDescription("Repair card markdown description"));

const flowCompleteStepsCmd = Command.make(
	"complete-steps",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleCompleteSteps,
).pipe(Command.withDescription("Complete pending steps"));

const flowStandardizeCmd = Command.make(
	"standardize",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStd,
).pipe(Command.withAlias("std"), Command.withDescription("Standardize a single card"));

const flowStandardizeAllCmd = Command.make("standardize-all", {}, handleStdAll).pipe(
	Command.withAlias("std-all"),
	Command.withDescription("Standardize all board cards"),
);

const flowAddCmd = Command.make(
	"add",
	{
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to assign"),
			Argument.withMetavar("USER"),
		),
		title: Argument.string("title").pipe(Argument.withDescription("Card title")),
		desc: Flag.string("desc").pipe(Flag.withDescription("Description file path ('-' for stdin)")),
	},
	handleAdd,
).pipe(Command.withDescription("Create a new card (manual action)"));

const flowStepsFromDescCmd = Command.make(
	"steps-from-desc",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStepsFromDesc,
).pipe(Command.withDescription("Sync steps from card description"));

const flowTemplateCmd = Command.make(
	"template",
	{
		draft: Flag.boolean("draft").pipe(Flag.withDescription("Create a draft card file")),
	},
	handleFlowTemplate,
).pipe(Command.withDescription("Read card template or create draft"));

const flowDoctorCmd = Command.make(
	"doctor",
	{
		apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply flow health fixes")),
	},
	handleDoctor,
).pipe(Command.withDescription("Check flow health"));

const flowHealthCmd = Command.make("health", {}, handleHealth).pipe(
	Command.withDescription("Deprecated: use `fizzyx planner health`"),
);

const flowInitCmd = Command.make("init", {}, handleFlowInit).pipe(
	Command.withDescription("Initialize flow config"),
);

export const flowCmd = Command.make("flow").pipe(
	Command.withDescription("Manage Fizzy workflow boards"),
	Command.withSubcommands([
		flowSyncCmd,
		flowMineCmd,
		flowStatusCmd,
		flowNextCmd,
		flowShowCmd,
		flowReadyCmd,
		flowStartCmd,
		flowReviewCmd,
		flowDoneCmd,
		flowBlockCmd,
		flowAssignCmd,
		flowCommentTemplateCmd,
		flowWorkflowCmd,
		flowSkillCmd,
		flowRepairMarkdownCmd,
		flowCompleteStepsCmd,
		flowStandardizeCmd,
		flowStandardizeAllCmd,
		flowAddCmd,
		flowStepsFromDescCmd,
		flowTemplateCmd,
		flowDoctorCmd,
		flowHealthCmd,
		flowInitCmd,
	]),
);
