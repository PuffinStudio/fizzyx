import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { add } from "../../use-cases/flow-service";
import { createFlowDraft } from "../flow-content";
import { readDescription } from "../flow-input";
import { runWithFlowEnv } from "../flow-workflow";
import { formatCreatingCardMessage } from "../flow-output";

const handleCreate = (config: {
	user: Option.Option<string>;
	title: Option.Option<string>;
	desc: Option.Option<string>;
	draft: boolean;
	skill: ReadonlyArray<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.draft) {
			const draft = yield* createFlowDraft({
				user: Option.getOrElse(config.user, () => undefined),
				title: Option.getOrElse(config.title, () => undefined),
				suggestedSkills: config.skill,
			});
			yield* Console.log(draft.path);
			return;
		}

		if (Option.isNone(config.user) || Option.isNone(config.title) || Option.isNone(config.desc)) {
			yield* Console.log("usage: fizzyx flow create <user> <title> --desc <file|->");
			return yield* Effect.fail(new Error("description input is required"));
		}

		const user = Option.getOrElse(config.user, () => "");
		const title = Option.getOrElse(config.title, () => "");
		const desc = Option.getOrElse(config.desc, () => "");
		const number = yield* runWithFlowEnv(formatCreatingCardMessage(), (env) =>
			Effect.gen(function* () {
				const description = yield* readDescription(desc);
				return yield* add(env, {
					user,
					title,
					description,
					suggestedSkills: config.skill,
				});
			}),
		);
		yield* Console.log(`${number}`);
	});

export const flowCreateCmd = Command.make(
	"create",
	{
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to assign"),
			Argument.withMetavar("USER"),
			Argument.optional,
		),
		title: Argument.string("title").pipe(Argument.withDescription("Card title"), Argument.optional),
		desc: Flag.string("desc").pipe(
			Flag.withDescription("Description file path ('-' for stdin)"),
			Flag.optional,
		),
		draft: Flag.boolean("draft").pipe(Flag.withDescription("Create a local card draft")),
		skill: Flag.string("skill").pipe(
			Flag.withDescription("Suggested skill to add to the card body"),
			Flag.atLeast(0),
		),
	},
	handleCreate,
).pipe(Command.withDescription("Create a new card"));
