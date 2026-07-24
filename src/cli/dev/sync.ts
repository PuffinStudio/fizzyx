import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { syncBranch, getStatus } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: { stash: boolean; agent: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const status = yield* getStatus();
		if (!config.agent) {
			yield* Console.log(`Syncing '${status.currentBranch}' with base...`);
		}

		const result = yield* syncBranch(config.stash);

		if (config.agent) {
			yield* Console.log([`branch: ${status.currentBranch}`, `synced: yes`, `detail: ${result}`].join("\n"));
			return;
		}
		yield* logSuccess(result);
	});

export const devSyncCmd = Command.make(
	"sync",
	{
		stash: Flag.boolean("stash").pipe(
			Flag.withDescription("Auto-stash uncommitted changes before sync"),
		),
		agent: Flag.boolean("agent").pipe(Flag.withDescription("Machine-readable output for AI agents")),
	},
	handle,
).pipe(Command.withDescription("Synchronize branch with its base"));
