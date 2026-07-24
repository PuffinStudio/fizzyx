import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { edit } from "../../use-cases/flow-service";
import { readDescription } from "../flow-input";
import { formatEditingCardMessage } from "../flow-output";
import { runWithFlowEnv } from "../flow-workflow";
import { createCardEditDraft } from "../flow-content";
import { ValidationError } from "../../domain/errors";
import { flowJson } from "../flow-json";

const handleEdit = (config: {
	card: number;
	title: Option.Option<string>;
	desc: Option.Option<string>;
	draft: boolean;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.draft) {
			if (Option.isSome(config.title) || Option.isSome(config.desc)) {
				return yield* new ValidationError({
					message: "--draft cannot be combined with --title or --desc",
				});
			}
			const draft = yield* runWithFlowEnv(formatEditingCardMessage(), (env) =>
				env.api.showCard(config.card).pipe(Effect.flatMap(createCardEditDraft)),
			);
			yield* Console.log(
				config.json
					? flowJson({ path: draft.path }, `Rebuilt edit draft at ${draft.path}`, [
							{
								action: "edit",
								cmd: `fizzyx flow edit ${config.card} --desc ${draft.path}`,
								description: "Apply the edited draft to the card",
							},
						])
					: draft.path,
			);
			return;
		}
		const title = Option.getOrUndefined(config.title);
		const description = Option.isSome(config.desc)
			? yield* readDescription(config.desc.value)
			: undefined;
		const number = yield* runWithFlowEnv(formatEditingCardMessage(), (env) =>
			edit(env, config.card, { title, description }),
		);
		yield* Console.log(
			config.json
				? flowJson({ number }, `Edited card ${number}`, [
						{ action: "show", cmd: `fizzyx flow show ${number}`, description: "View the card" },
					])
				: `${number}`,
		);
	});

export const flowEditCmd = Command.make(
	"edit",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		title: Flag.string("title").pipe(Flag.withDescription("New card title"), Flag.optional),
		desc: Flag.string("desc").pipe(
			Flag.withDescription("New description file path ('-' for stdin)"),
			Flag.optional,
		),
		draft: Flag.boolean("draft").pipe(
			Flag.withDescription("Rebuild a standard edit draft from the remote card"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleEdit,
).pipe(Command.withDescription("Edit a card title or description"));
