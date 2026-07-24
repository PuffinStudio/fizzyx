import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ValidationError } from "../../domain/errors";
import { addComment } from "../../use-cases/flow-service";
import { readDescription } from "../flow-input";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleComment = (config: {
	card: number;
	body: Option.Option<string>;
	bodyFile: Option.Option<string>;
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
		const result = yield* runWithFlowRuntimeEnv("Adding comment...", (env) =>
			addComment(env, config.card, body),
		);
		yield* Console.log(
			config.json
				? flowJson(result, `commented #${result.number}`, [
						{
							action: "show",
							cmd: `fizzyx flow show ${result.number}`,
							description: "View the card",
						},
					])
				: `commented #${result.number}`,
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
			Flag.withDescription("Markdown comment file path ('-' for stdin)"),
			Flag.optional,
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleComment,
).pipe(Command.withDescription("Add a Markdown note comment to a card"));
