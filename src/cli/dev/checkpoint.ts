import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { checkpoint } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: {
	message: Option.Option<string>;
	all: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const msg = yield* checkpoint(
			Option.getOrElse(config.message, () => undefined),
			config.all,
		);
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
	},
	handle,
).pipe(Command.withDescription("Create a local checkpoint commit"));
