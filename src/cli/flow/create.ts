import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { add } from "../../use-cases/flow-service";
import { createFlowDraft } from "../flow-content";
import { readDescription } from "../flow-input";
import { runWithFlowEnv } from "../flow-workflow";
import { formatCreatingCardMessage } from "../flow-output";
import { flowJson } from "../flow-json";

const handleCreate = (config: {
	title: Option.Option<string>;
	desc: Option.Option<string>;
	draft: boolean;
	assign: Option.Option<string>;
	skill: ReadonlyArray<string>;
	json: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const title = Option.getOrElse(config.title, () => "");
		const assignee = Option.getOrElse(config.assign, () => undefined);

		if (config.draft) {
			const draft = yield* createFlowDraft({
				user: assignee,
				title,
				suggestedSkills: config.skill,
			});
			yield* Console.log(
				config.json
					? flowJson({ path: draft.path }, `Created draft at ${draft.path}`, [
							{
								action: "create",
								cmd: `fizzyx flow create "<title>" --desc ${draft.path}`,
								description: "Fill the draft, then create the card from it",
							},
						])
					: draft.path,
			);
			return;
		}

		if (!title || Option.isNone(config.desc)) {
			yield* Console.log("usage: fizzyx flow create <title> --desc <file|-> [--assign <user>]");
			return yield* Effect.fail(new Error("description input is required"));
		}

		const desc = Option.getOrElse(config.desc, () => "");
		const number = yield* runWithFlowEnv(formatCreatingCardMessage(), (env) =>
			Effect.gen(function* () {
				const description = yield* readDescription(desc);
				return yield* add(env, {
					assignee,
					title,
					description,
					suggestedSkills: config.skill,
				});
			}),
		);
		yield* Console.log(
			config.json
				? flowJson({ number }, `Created card ${number}`, [
						{ action: "show", cmd: `fizzyx flow show ${number}`, description: "View the card" },
						{ action: "start", cmd: `fizzyx flow start ${number}`, description: "Start the card" },
					])
				: `${number}`,
		);
	});

export const flowCreateCmd = Command.make(
	"create",
	{
		title: Argument.string("title").pipe(
			Argument.withDescription("Card title; required unless --draft is used"),
			Argument.optional,
		),
		desc: Flag.string("desc").pipe(
			Flag.withDescription("Description file path ('-' for stdin)"),
			Flag.optional,
		),
		draft: Flag.boolean("draft").pipe(Flag.withDescription("Create a local card draft")),
		assign: Flag.string("assign").pipe(
			Flag.withDescription("Assign the new card to a configured Fizzy user"),
			Flag.optional,
		),
		skill: Flag.string("skill").pipe(
			Flag.withDescription("Suggested skill to add to the card body"),
			Flag.atLeast(0),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
	},
	handleCreate,
).pipe(Command.withDescription("Create a new card"));
