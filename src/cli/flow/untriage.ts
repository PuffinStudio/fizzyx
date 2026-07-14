import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { untriage } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleUntriage = (config: { card: number; json: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const number = yield* runWithFlowRuntimeEnv("Sending card to Maybe...", (env) =>
			untriage(env, config.card),
		);
		yield* Console.log(
			config.json
				? flowJson({ number, untriaged: true }, `untriaged #${number}`, [
						{
							action: "move",
							cmd: `fizzyx flow move ${number} <column>`,
							description: "Move the card to a column",
						},
					])
				: `untriaged #${number}`,
		);
	});

export const flowUntriageCmd = Command.make(
	"untriage",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleUntriage,
).pipe(Command.withDescription("Send a card back to Fizzy Maybe/triage"));
