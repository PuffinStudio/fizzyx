import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { syncBranch, getStatus } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: { stash: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const status = yield* getStatus();
		yield* Console.log(`Syncing '${status.currentBranch}' with base...`);

		const result = yield* syncBranch(config.stash);
		yield* logSuccess(result);
	});

export const devSyncCmd = Command.make(
	"sync",
	{
		stash: Flag.boolean("stash").pipe(
			Flag.withDescription("Auto-stash uncommitted changes before sync"),
		),
	},
	handle,
).pipe(Command.withDescription("Synchronize branch with its base"));
