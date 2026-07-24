import { Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { assign } from "../../use-cases/flow-service";
import { formatAssignedCard, formatAssigningCardMessage } from "../flow-output";
import { runWithFlowEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleAssign = (config: {
	card: number;
	user: string;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowEnv(formatAssigningCardMessage(), (env) =>
			assign(env, config.card, [config.user]),
		);
		yield* Console.log(
			config.json
				? flowJson(result, formatAssignedCard(result.number, config.user), [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: formatAssignedCard(result.number, config.user),
		);
	});

export const flowAssignCmd = Command.make(
	"assign",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		user: Argument.string("user").pipe(
			Argument.withDescription("Configured Fizzy user, user id, or me"),
			Argument.withMetavar("USER"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleAssign,
).pipe(Command.withDescription("Assign a card"));
