import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { reopen } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleReopen = (config: { card: number; json: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const number = yield* runWithFlowRuntimeEnv("Reopening card...", (env) =>
			reopen(env, config.card),
		);
		yield* Console.log(
			config.json
				? flowJson({ number, reopened: true }, `reopened #${number}`, [
						{ action: "show", cmd: `fizzyx flow show ${number}`, description: "View the card" },
					])
				: `reopened #${number}`,
		);
	});

export const flowReopenCmd = Command.make(
	"reopen",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleReopen,
).pipe(Command.withDescription("Reopen a closed card"));
