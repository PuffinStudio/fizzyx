import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ValidationError } from "../../domain/errors";
import { addComment, editComment } from "../../use-cases/flow-service";
import { readDescription } from "../flow-input";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleComment = (config: {
	card: number;
	body: Option.Option<string>;
	bodyFile: Option.Option<string>;
	edit: Option.Option<string>;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (Option.isSome(config.body) === Option.isSome(config.bodyFile)) {
			return yield* new ValidationError({
				message: "Provide exactly one comment body or --body-file <file|->",
			});
		}
		const body = Option.isSome(config.body)
			? config.body.value
			: yield* readDescription(Option.getOrElse(config.bodyFile, () => ""));
		const editId = Option.getOrUndefined(config.edit);
		const editing = editId !== undefined;
		const result = yield* runWithFlowRuntimeEnv(
			editing ? "Updating comment..." : "Adding comment...",
			(env) =>
				editing ? editComment(env, config.card, editId, body) : addComment(env, config.card, body),
		);
		const message = editing
			? `updated comment ${editId} on #${result.number}`
			: `commented #${result.number}`;
		yield* Console.log(
			config.json
				? flowJson(result, message, [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: message,
		);
	});

export const flowCommentCmd = Command.make(
	"comment",
	{
		card: Argument.integer("card").pipe(
			Argument.withDescription("Card number"),
			Argument.withMetavar("CARD"),
		),
		body: Argument.string("body").pipe(Argument.withDescription("Comment text"), Argument.optional),
		bodyFile: Flag.string("body-file").pipe(
			Flag.withDescription("Comment file path ('-' for stdin)"),
			Flag.optional,
		),
		edit: Flag.string("edit").pipe(
			Flag.withDescription("Existing comment id to update"),
			Flag.optional,
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleComment,
).pipe(Command.withDescription("Add or edit a note comment on a card"));
