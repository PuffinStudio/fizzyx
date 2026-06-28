import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { block } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { formatBlockedCard, formatBlockingCardMessage } from "../flow-output";

const handleBlock = (config: { card: number; reason: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatBlockingCardMessage(), (env) =>
			block(env, config.card, config.reason),
		);
		yield* Console.log(formatBlockedCard(result.number, result.reason));
	});

export const flowBlockCmd = Command.make(
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
