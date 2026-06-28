import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { review } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { formatMovedCard, formatMovingCardToReviewMessage } from "../flow-output";

const handleReview = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatMovingCardToReviewMessage(), (env) =>
			review(env, config.card),
		);
		yield* Console.log(formatMovedCard(result.number, result.column));
	});

export const flowReviewCmd = Command.make(
	"review",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleReview,
).pipe(Command.withDescription("Move a card to REVIEW"));
