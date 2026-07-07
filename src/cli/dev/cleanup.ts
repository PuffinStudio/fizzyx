import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { cleanup } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: { abandon: boolean; force: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* cleanup(config.abandon || config.force);
		yield* logSuccess(result);
	});

export const devCleanupCmd = Command.make(
	"cleanup",
	{
		abandon: Flag.boolean("abandon").pipe(
			Flag.withDescription("Delete current branch even if not merged"),
		),
		force: Flag.boolean("force").pipe(Flag.withDescription("Force delete unmerged branches")),
	},
	handle,
).pipe(Command.withDescription("Clean local development state"));
