import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { review } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { formatMovedCard, formatMovingCardToReviewMessage } from "../flow-output";
import { flowJson } from "../flow-json";

const handleReview = (config: { card: number; json: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatMovingCardToReviewMessage(), (env) =>
			review(env, config.card),
		);
		yield* Console.log(
			config.json
				? flowJson(result, formatMovedCard(result.number, result.column), [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: formatMovedCard(result.number, result.column),
		);
	});

export const flowReviewCmd = Command.make(
	"review",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleReview,
).pipe(Command.withDescription("Move a card to the preset REVIEW column"));
