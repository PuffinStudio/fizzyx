import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { move } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { formatMovedCard } from "../flow-output";

const handleMove = (config: { card: number; column: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv("Moving card...", (env) =>
			move(env, config.card, config.column),
		);
		yield* Console.log(formatMovedCard(result.number, result.column));
	});

export const flowMoveCmd = Command.make(
	"move",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		column: Argument.string("column").pipe(
			Argument.withDescription("Target column id or exact name"),
			Argument.withMetavar("COLUMN"),
		),
	},
	handleMove,
).pipe(Command.withDescription("Move a card to any board column"));
