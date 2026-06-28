import { Console, Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { printCardDetail } from "../render";
import { show } from "../../use-cases/flow-service";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { formatLoadingCardDetailsMessage } from "../flow-output";

const handleShow = (config: { card: number }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv(formatLoadingCardDetailsMessage(), (env) =>
			show(env, config.card),
		);
		yield* Console.log(printCardDetail(result.card, result.comments));
	});

export const flowShowCmd = Command.make(
	"show",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
	},
	handleShow,
).pipe(Command.withDescription("Show card details"));
