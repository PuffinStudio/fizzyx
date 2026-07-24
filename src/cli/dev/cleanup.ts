import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { cleanup } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: {
	abandon: boolean;
	force: boolean;
	confirmDelete: boolean;
	agent: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* cleanup({
			abandon: config.abandon || config.force,
			confirmDelete: config.confirmDelete,
		});
		if (config.agent) {
			yield* Console.log(
				[`mode: ${config.confirmDelete ? "applied" : "preview"}`, `detail: ${result}`].join("\n"),
			);
			return;
		}
		yield* logSuccess(result);
	});

export const devCleanupCmd = Command.make(
	"cleanup",
	{
		abandon: Flag.boolean("abandon").pipe(
			Flag.withDescription("Delete current branch even if not merged"),
		),
		force: Flag.boolean("force").pipe(Flag.withDescription("Force delete unmerged branches")),
		confirmDelete: Flag.boolean("confirm-delete").pipe(
			Flag.withDescription("Explicitly confirm local branch deletion"),
		),
		agent: Flag.boolean("agent").pipe(Flag.withDescription("Machine-readable output for AI agents")),
	},
	handle,
).pipe(Command.withDescription("Clean local development state"));
