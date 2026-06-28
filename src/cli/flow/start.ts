import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { start } from "../../use-cases/flow-service";
import { logSuccess } from "../ui";
import { runWithFlowEnv } from "../flow-workflow";
import { formatStartedCard, formatStartingCardMessage } from "../flow-output";

const handleStart = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* runWithFlowEnv(formatStartingCardMessage(), (env) => start(env, config.card));
		yield* logSuccess(formatStartedCard(config.card));
	});

export const flowStartCmd = Command.make(
	"start",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleStart,
).pipe(Command.withDescription("Start a card"));
