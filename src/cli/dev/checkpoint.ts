import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { checkpoint } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: {
	message: Option.Option<string>;
	all: boolean;
	agent: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const msg = yield* checkpoint(
			Option.getOrElse(config.message, () => undefined),
			config.all,
		);
		if (config.agent) {
			const checkpointed = !msg.startsWith("No changes");
			yield* Console.log(
				[`checkpointed: ${checkpointed ? "yes" : "no"}`, `message: ${msg}`].join("\n"),
			);
			return;
		}
		yield* logSuccess(msg);
	});

export const devCheckpointCmd = Command.make(
	"checkpoint",
	{
		message: Flag.optional(
			Flag.string("message").pipe(
				Flag.withDescription("Commit message (auto-generates wip: if omitted)"),
			),
		),
		all: Flag.boolean("all").pipe(
			Flag.withDescription("Stage all tracked changes before committing"),
		),
		agent: Flag.boolean("agent").pipe(
			Flag.withDescription("Machine-readable output for AI agents"),
		),
	},
	handle,
).pipe(Command.withDescription("Create a local checkpoint commit"));
