import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { block } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { formatBlockedCard, formatBlockingCardMessage } from "../flow-output";
import { flowJson } from "../flow-json";

const handleBlock = (config: {
	card: number;
	reason: string;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatBlockingCardMessage(), (env) =>
			block(env, config.card, config.reason),
		);
		yield* Console.log(
			config.json
				? flowJson(result, formatBlockedCard(result.number, result.reason), [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: formatBlockedCard(result.number, result.reason),
		);
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
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleBlock,
).pipe(Command.withDescription("Block a card"));
