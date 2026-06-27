import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { printCardDetail, printCards, printSteps } from "./render";
import { runWithFlowEnv, runWithFlowRuntimeEnv } from "./flow-workflow";
import {
	formatAssignedCard,
	formatAssigningCardMessage,
	formatBlockingCardMessage,
	formatBlockedCard,
	formatCheckingFlowHealthMessage,
	formatClosedCard,
	formatClosingCardMessage,
	formatCommentTemplate,
	formatCompleteStepsSummary,
	formatCompletedSteps,
	formatCreatingCardMessage,
	formatDoctorResult,
	formatFlowConfigMissing,
	formatFlowConfigured,
	formatImproveGuidance,
	formatInitializingWorkflowConfigMessage,
	formatLoadingCardDetailsMessage,
	formatLoadingWorkSummaryMessage,
	formatMovedCard,
	formatMovingCardToReviewMessage,
	formatNextActionHint,
	formatNextSummary,
	formatNoCurrentWork,
	formatNoTodoCard,
	formatNotNowSection,
	formatRepairingDescriptionMessage,
	formatRepairedCard,
	formatStandardizeBoardResults,
	formatStandardizeBoardSummary,
	formatStandardizeResult,
	formatStandardizingBoardMessage,
	formatStandardizingCardMessage,
	formatStartedCard,
	formatStartingCardMessage,
	formatSyncingDoneWhenStepsMessage,
	formatWorkBoardSummary,
	formatWorkHeader,
	formatWorkSection,
} from "./flow-output";
import {
	add,
	analyzeDoctor,
	assign,
	block,
	bootstrapFlowConfig,
	done,
	getStandardizedCommentTemplate,
	mine,
	nextOrStart,
	repairDoctor,
	repairMarkdownDescription,
	resolveDoneRefFromGit,
	review,
	show,
	start,
	status,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
} from "../use-cases/flow-service";
import { logSuccess } from "./ui";
import { readDescription } from "./flow-input";
import {
	formatRepairMetadataChange,
	formatRepairMetadataReminder,
	formatRepairMetadataSummary,
} from "./planner-output";
import { repairPlannerMetadata } from "../use-cases/planner-service";

const handleWork = (config: {
	fresh: boolean;
	user: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const resolvedUser = Option.isSome(config.user) ? config.user.value : undefined;
		const result = yield* runWithFlowEnv(formatLoadingWorkSummaryMessage(), (env) =>
			Effect.gen(function* () {
				const statusResult = yield* status(env, { fresh: config.fresh });
				const mineResult = yield* mine(env, { fresh: false, user: resolvedUser });
				const nextResult = yield* nextOrStart(env, { fresh: false, autoStart: false });
				return { statusResult, mineResult, nextResult };
			}),
		);

		yield* Console.log(formatWorkHeader(result.mineResult.name, result.mineResult.userId));
		yield* Console.log(
			formatWorkBoardSummary(
				result.statusResult.age,
				result.statusResult.cache.cards.length,
				result.statusResult.cache.notNow.length,
			),
		);
		yield* Console.log(formatWorkSection("current"));
		if (result.mineResult.cards.length > 0) {
			yield* Console.log(printCards(result.mineResult.cards));
		} else {
			yield* Console.log(formatNoCurrentWork());
		}

		yield* Console.log(formatWorkSection("next"));
		if (result.nextResult.card) {
			yield* Console.log(
				formatNextSummary(result.nextResult.card.number, result.nextResult.card.title),
			);
			yield* Console.log(formatNextActionHint(result.nextResult.card.number));
		} else {
			yield* Console.log(formatNoTodoCard(result.nextResult.user.name));
		}

		if (result.statusResult.cache.notNow.length > 0) {
			yield* Console.log(formatNotNowSection(result.statusResult.cache.notNow.length));
			yield* Console.log(printCards(result.statusResult.cache.notNow, { systemColumn: "NOT_NOW" }));
		}
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
	completeSteps: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const explicitRef = Option.isSome(config.ref) ? config.ref.value : undefined;
		const resolvedRef = explicitRef ?? (yield* resolveDoneRefFromGit());
		const result = yield* runWithFlowEnv(formatClosingCardMessage(), (env) =>
			done(env, config.card, resolvedRef, { completeSteps: config.completeSteps }),
		);

		if (result.completedSteps && result.completedSteps.updatedCount > 0) {
			yield* logSuccess(
				formatCompleteStepsSummary(result.completedSteps.updatedCount, result.number),
			);
			if (result.completedSteps.contents.length > 0) {
				yield* Console.log(formatCompletedSteps(result.completedSteps.contents));
			}
		}

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

const handleCreate = (config: {
	user: string;
	title: string;
	desc: string;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const number = yield* runWithFlowEnv(formatCreatingCardMessage(), (env) =>
			Effect.gen(function* () {
				const description = yield* readDescription(config.desc);
				return yield* add(env, {
					user: config.user,
					title: config.title,
					description,
				});
			}),
		);
		yield* Console.log(`${number}`);
	});

const handleRepairMetadata = (config: {
	apply: boolean;
	defaultPriority: Option.Option<"p0" | "p1" | "p2">;
	defaultType: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* repairPlannerMetadata({
			apply: config.apply,
			defaultPriority:
				config.defaultPriority._tag === "Some" ? config.defaultPriority.value : undefined,
			defaultType: config.defaultType._tag === "Some" ? config.defaultType.value : undefined,
		});
		yield* Console.log(formatRepairMetadataSummary(result));
		for (const change of result.changes.filter((item) => item.action === "tag_card")) {
			yield* Console.log(
				formatRepairMetadataChange(change.cardNumber, change.action, change.reason, change.title),
			);
		}
		if (!config.apply) {
			yield* Console.log(formatRepairMetadataReminder());
		}
	});

const handleRepair = (config: {
	card: Option.Option<number>;
	all: boolean;
	kind: Option.Option<"standardize" | "steps" | "metadata" | "markdown">;
	apply: boolean;
	defaultPriority: Option.Option<"p0" | "p1" | "p2">;
	defaultType: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const kind = Option.getOrElse(config.kind, () => "standardize");

		if (kind === "metadata") {
			yield* handleRepairMetadata({
				apply: config.apply,
				defaultPriority: config.defaultPriority,
				defaultType: config.defaultType,
			});
			return;
		}

		if (config.all) {
			const result = yield* runWithFlowEnv(formatStandardizingBoardMessage(), (env) =>
				standardizeBoard(env),
			);
			yield* Console.log(formatStandardizeBoardResults(result.results));
			yield* Console.log(formatStandardizeBoardSummary(result));
			return;
		}

		if (Option.isNone(config.card)) {
			yield* Console.log("usage: fizzyx flow repair [--kind <kind>] [--all] <card>");
			return;
		}

		const card = config.card.value;
		switch (kind) {
			case "steps": {
				const steps = yield* runWithFlowEnv(formatSyncingDoneWhenStepsMessage(), (env) =>
					stepsFromDescription(env, card),
				);
				yield* Console.log(printSteps(steps));
				return;
			}
			case "markdown": {
				const repaired = yield* runWithFlowEnv(formatRepairingDescriptionMessage(), (env) =>
					repairMarkdownDescription(env, card),
				);
				yield* logSuccess(formatRepairedCard(repaired));
				return;
			}
			default: {
				const result = yield* runWithFlowEnv(formatStandardizingCardMessage(), (env) =>
					standardizeCard(env, card),
				);
				yield* Console.log(formatStandardizeResult(result));
			}
		}
	});

const handleImprove = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log(formatImproveGuidance());
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

const flowWorkCmd = Command.make(
	"work",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to summarize"),
			Argument.optional,
		),
	},
	handleWork,
).pipe(Command.withDescription("Show the daily work summary"));

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
		completeSteps: Flag.boolean("complete-steps").pipe(
			Flag.withDescription("Complete pending steps before closing"),
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

const flowCreateCmd = Command.make(
	"create",
	{
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to assign"),
			Argument.withMetavar("USER"),
		),
		title: Argument.string("title").pipe(Argument.withDescription("Card title")),
		desc: Flag.string("desc").pipe(Flag.withDescription("Description file path ('-' for stdin)")),
	},
	handleCreate,
).pipe(Command.withAlias("add"), Command.withDescription("Create a new card"));

const flowImproveCmd = Command.make("improve", {}, handleImprove).pipe(
	Command.withDescription("Review improvement candidates"),
);

const flowRepairCmd = Command.make(
	"repair",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
			Argument.optional,
		),
		all: Flag.boolean("all").pipe(Flag.withDescription("Repair or standardize all board cards")),
		kind: Flag.choice("kind", ["standardize", "steps", "metadata", "markdown"] as const).pipe(
			Flag.withDescription("Repair kind"),
			Flag.optional,
		),
		apply: Flag.boolean("apply").pipe(
			Flag.withDescription("Apply metadata tag repairs to Fizzy cards"),
		),
		defaultPriority: Flag.choice("default-priority", ["p0", "p1", "p2"] as const).pipe(
			Flag.withDescription("Default priority for cards without priority metadata"),
			Flag.optional,
		),
		defaultType: Flag.string("default-type").pipe(
			Flag.withDescription("Default type for cards without type metadata"),
			Flag.optional,
		),
	},
	handleRepair,
).pipe(Command.withDescription("Repair cards, steps, markdown, or metadata"));

const flowDoctorCmd = Command.make(
	"doctor",
	{
		apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply flow health fixes")),
	},
	handleDoctor,
).pipe(Command.withDescription("Check flow health"));

const flowInitCmd = Command.make("init", {}, handleFlowInit).pipe(
	Command.withDescription("Initialize flow config"),
);

export const flowCmd = Command.make("flow").pipe(
	Command.withDescription("Manage Fizzy workflow boards"),
	Command.withSubcommands([
		flowWorkCmd,
		flowCreateCmd,
		flowShowCmd,
		flowStartCmd,
		flowReviewCmd,
		flowDoneCmd,
		flowBlockCmd,
		flowImproveCmd,
		flowRepairCmd,
		flowDoctorCmd,
		flowAssignCmd,
		flowCommentTemplateCmd,
		flowInitCmd,
	]),
);
