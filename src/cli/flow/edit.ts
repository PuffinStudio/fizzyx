import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { edit } from "../../use-cases/flow-service";
import { readDescription } from "../flow-input";
import { formatEditingCardMessage } from "../flow-output";
import { runWithFlowEnv } from "../flow-workflow";

const handleEdit = (config: {
	card: number;
	title: Option.Option<string>;
	desc: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const title = Option.getOrUndefined(config.title);
		const description = Option.isSome(config.desc)
			? yield* readDescription(config.desc.value)
			: undefined;
		const number = yield* runWithFlowEnv(formatEditingCardMessage(), (env) =>
			edit(env, config.card, { title, description }),
		);
		yield* Console.log(`${number}`);
	});

export const flowEditCmd = Command.make(
	"edit",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		title: Flag.string("title").pipe(
			Flag.withDescription("New card title"),
			Flag.optional,
		),
		desc: Flag.string("desc").pipe(
			Flag.withDescription("New description file path ('-' for stdin)"),
			Flag.optional,
		),
	},
	handleEdit,
).pipe(Command.withDescription("Edit a card title or description"));
