import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { printCardDetail } from "../render";
import { show } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { ValidationError } from "../../domain/errors";
import { formatLoadingCardDetailsMessage, formatTogglingStepMessage } from "../flow-output";
import { flowJson } from "../flow-json";

type ToggleResult = {
	index: number;
	completed: boolean;
	skipped: boolean;
} | null;

const handleShow = (config: {
	card: number;
	check: Option.Option<number>;
	uncheck: Option.Option<number>;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const checkIndex = Option.isSome(config.check) ? config.check.value : undefined;
		const uncheckIndex = Option.isSome(config.uncheck) ? config.uncheck.value : undefined;

		if (checkIndex !== undefined && uncheckIndex !== undefined) {
			yield* new ValidationError({
				message: "Cannot use --check and --uncheck together. Pick one.",
			});
		}

		const wantToggle = checkIndex !== undefined || uncheckIndex !== undefined;
		const message = wantToggle ? formatTogglingStepMessage() : formatLoadingCardDetailsMessage();

		const result = yield* runWithFlowRuntimeEnv(message, (env) =>
			Effect.gen(function* () {
				const { card, comments } = yield* show(env, config.card);
				if (!wantToggle) {
					return { card, comments, toggled: null satisfies ToggleResult };
				}
				const targetIndex = (checkIndex ?? uncheckIndex)!;
				const completed = checkIndex !== undefined;
				const steps = card.steps ?? [];
				if (targetIndex < 1 || targetIndex > steps.length) {
					yield* new ValidationError({
						message: `Step #${targetIndex} is out of range. Card #${config.card} has ${steps.length} step(s).`,
					});
				}
				const step = steps[targetIndex - 1]!;
				if (!step.id) {
					yield* new ValidationError({
						message: `Step #${targetIndex} has no id and cannot be toggled remotely.`,
					});
				}
				if (step.completed === completed) {
					return {
						card,
						comments,
						toggled: { index: targetIndex, completed, skipped: true } satisfies ToggleResult,
					};
				}
				yield* env.api.updateStep(config.card, step.id!, { completed });
				const updatedSteps = steps.map((s, i) => (i === targetIndex - 1 ? { ...s, completed } : s));
				return {
					card: { ...card, steps: updatedSteps },
					comments,
					toggled: { index: targetIndex, completed, skipped: false } satisfies ToggleResult,
				};
			}),
		);

		if (config.json) {
			yield* Console.log(
				flowJson(result, `Card #${result.card.number}: ${result.card.title}`, [
					{
						action: "comment",
						cmd: `fizzyx flow comment ${result.card.number} <body>`,
						description: "Add a note",
					},
					{
						action: "move",
						cmd: `fizzyx flow move ${result.card.number} <column>`,
						description: "Move the card",
					},
				]),
			);
			return;
		}

		if (result.toggled) {
			if (result.toggled.skipped) {
				yield* Console.log(
					`Step #${result.toggled.index} is already ${result.toggled.completed ? "checked" : "unchecked"}.`,
				);
			} else {
				yield* Console.log(
					`${result.toggled.completed ? "Checked" : "Unchecked"} step #${result.toggled.index} on card #${config.card}.`,
				);
			}
		}
		// Display limit for the human-readable path only. --json above returns every
		// comment, so a programmatic reader is never silently clipped.
		const shown = result.comments.slice(-textCommentLimit);
		if (shown.length < result.comments.length) {
			yield* Console.log(
				`(showing the ${shown.length} most recent of ${result.comments.length} comments; use --json for all)`,
			);
		}
		yield* Console.log(printCardDetail(result.card, shown));
	});

const textCommentLimit = 20;

export const flowShowCmd = Command.make(
	"show",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		check: Flag.optional(
			Flag.integer("check").pipe(
				Flag.withDescription("Check (complete) a step by its 1-based index"),
			),
		),
		uncheck: Flag.optional(
			Flag.integer("uncheck").pipe(
				Flag.withDescription("Uncheck (mark incomplete) a step by its 1-based index"),
			),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print card and comments as JSON")),
	},
	handleShow,
).pipe(Command.withDescription("Show card details; toggle steps with --check/--uncheck"));
