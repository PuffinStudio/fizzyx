import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { getStatus, formatStatus, loadConfigOptional } from "../../use-cases/dev-service";

const handle = (config: { agent: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const projectConfig = yield* loadConfigOptional();
		const status = yield* getStatus(projectConfig);
		yield* Console.log(formatStatus(status, config.agent));
	});

export const devStatusCmd = Command.make(
	"status",
	{
		agent: Flag.boolean("agent").pipe(
			Flag.withDescription("Machine-readable output for AI agents"),
		),
	},
	handle,
).pipe(Command.withDescription("Show current branch status and role"));
