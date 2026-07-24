import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { acceptBaseline, showBaseline } from "../../use-cases/dev-service";

const show = () =>
	Effect.gen(function* () {
		const result = yield* showBaseline();
		yield* Console.log(`branch: ${result.branch}`);
		yield* Console.log(`baseline: ${result.baseline ? result.baseline.capturedAt : "missing"}`);
		yield* Console.log(`baseline_files: ${result.baseline?.entries.length ?? 0}`);
		yield* Console.log(`current_files: ${result.current.length}`);
	});

const accept = (config: { agent: boolean }) =>
	Effect.gen(function* () {
		const baseline = yield* acceptBaseline();
		if (config.agent) {
			yield* Console.log(
				[`accepted: ${baseline.entries.length}`, `branch: ${baseline.branch}`].join("\n"),
			);
			return;
		}
		yield* Console.log(
			`Accepted ${baseline.entries.length} file(s) as baseline on ${baseline.branch}.`,
		);
	});

const baselineShowCmd = Command.make("show", {}, show).pipe(
	Command.withDescription("Show the current branch worktree baseline"),
);

const baselineAcceptCmd = Command.make(
	"accept",
	{
		agent: Flag.boolean("agent").pipe(
			Flag.withDescription("Machine-readable output for AI agents"),
		),
	},
	accept,
).pipe(Command.withDescription("Accept the current worktree as the branch baseline"));

export const devBaselineCmd = Command.make("baseline").pipe(
	Command.withDescription("Manage local pre-existing worktree state"),
	Command.withSubcommands([baselineShowCmd, baselineAcceptCmd]),
);
