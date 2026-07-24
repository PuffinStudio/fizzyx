import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { printSteps } from "../render";
import { logSuccess } from "../ui";
import {
	formatRepairedCard,
	formatRepairingDescriptionMessage,
	formatStandardizeBoardResults,
	formatStandardizeBoardSummary,
	formatStandardizeResult,
	formatStandardizingBoardMessage,
	formatStandardizingCardMessage,
	formatSyncingDoneWhenStepsMessage,
} from "../flow-output";
import {
	formatRepairMetadataChange,
	formatRepairMetadataReminder,
	formatRepairMetadataSummary,
} from "../planner-output";
import { repairPlannerMetadata } from "../../use-cases/planner-service";
import {
	repairMarkdownDescription,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
} from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleRepairMetadata = (config: {
	apply: boolean;
	json: boolean;
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
		if (config.json) {
			yield* Console.log(flowJson(result, formatRepairMetadataSummary(result)));
			return;
		}
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
	json: boolean;
	defaultPriority: Option.Option<"p0" | "p1" | "p2">;
	defaultType: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const kind = Option.getOrElse(config.kind, () => "standardize");

		if (kind === "metadata") {
			yield* handleRepairMetadata({
				apply: config.apply,
				json: config.json,
				defaultPriority: config.defaultPriority,
				defaultType: config.defaultType,
			});
			return;
		}

		if (config.all) {
			const result = yield* runWithFlowEnv(formatStandardizingBoardMessage(), (env) =>
				standardizeBoard(env),
			);
			if (config.json) {
				yield* Console.log(flowJson(result, formatStandardizeBoardSummary(result)));
				return;
			}
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
				yield* Console.log(
					config.json ? flowJson({ steps }, `${steps.length} step(s)`) : printSteps(steps),
				);
				return;
			}
			case "markdown": {
				const repaired = yield* runWithFlowEnv(formatRepairingDescriptionMessage(), (env) =>
					repairMarkdownDescription(env, card),
				);
				if (config.json) {
					yield* Console.log(flowJson(repaired, formatRepairedCard(repaired)));
					return;
				}
				yield* logSuccess(formatRepairedCard(repaired));
				return;
			}
			default: {
				const result = yield* runWithFlowEnv(formatStandardizingCardMessage(), (env) =>
					standardizeCard(env, card),
				);
				yield* Console.log(
					config.json
						? flowJson(result, formatStandardizeResult(result))
						: formatStandardizeResult(result),
				);
			}
		}
	});

export const flowRepairCmd = Command.make(
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
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
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
