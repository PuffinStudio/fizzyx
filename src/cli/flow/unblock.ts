import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { unblock } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleUnblock = (config: {
	card: number;
	reason: string;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv("Unblocking card...", (env) =>
			unblock(env, config.card, config.reason),
		);
		yield* Console.log(
			config.json
				? flowJson(result, `unblocked #${result.number}`, [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: `unblocked #${result.number}: ${result.reason}`,
		);
	});

export const flowUnblockCmd = Command.make(
	"unblock",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		reason: Argument.string("reason").pipe(
			Argument.withDescription("What made the card actionable again"),
			Argument.withMetavar("REASON"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleUnblock,
).pipe(Command.withDescription("Resume a blocked card in the configured default column"));
