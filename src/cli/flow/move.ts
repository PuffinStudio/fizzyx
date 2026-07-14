import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { move } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { formatMovedCard } from "../flow-output";
import { flowJson } from "../flow-json";

const handleMove = (config: {
	card: number;
	column: string;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv("Moving card...", (env) =>
			move(env, config.card, config.column),
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

export const flowMoveCmd = Command.make(
	"move",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		column: Argument.string("column").pipe(
			Argument.withDescription("Target column id/name, maybe, triage, or not-now"),
			Argument.withMetavar("COLUMN"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleMove,
).pipe(Command.withDescription("Move a card to any board column"));
