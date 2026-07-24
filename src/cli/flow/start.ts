import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { start } from "../../use-cases/flow-service";
import { logSuccess } from "../ui";
import { runWithFlowEnv } from "../flow-workflow";
import { formatStartedCard, formatStartingCardMessage } from "../flow-output";
import { flowJson } from "../flow-json";

const handleStart = (config: { card: number; json: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatStartingCardMessage(), (env) =>
			start(env, config.card),
		);
		if (config.json) {
			yield* Console.log(
				flowJson(result, formatStartedCard(config.card), [
					{ action: "show", cmd: `fizzyx flow show ${config.card}`, description: "View the card" },
				]),
			);
			return;
		}
		yield* logSuccess(formatStartedCard(config.card));
	});

export const flowStartCmd = Command.make(
	"start",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleStart,
).pipe(Command.withDescription("Start a card"));
