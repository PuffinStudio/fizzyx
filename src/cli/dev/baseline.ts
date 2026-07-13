import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { acceptBaseline, showBaseline } from "../../use-cases/dev-service";

const show = () =>
	Effect.gen(function* () {
		const result = yield* showBaseline();
		yield* Console.log(`branch: ${result.branch}`);
		yield* Console.log(`baseline: ${result.baseline ? result.baseline.capturedAt : "missing"}`);
		yield* Console.log(`baseline_files: ${result.baseline?.entries.length ?? 0}`);
		yield* Console.log(`current_files: ${result.current.length}`);
	});

const accept = () =>
	Effect.gen(function* () {
		const baseline = yield* acceptBaseline();
		yield* Console.log(
			`Accepted ${baseline.entries.length} file(s) as baseline on ${baseline.branch}.`,
		);
	});

const baselineShowCmd = Command.make("show", {}, show).pipe(
	Command.withDescription("Show the current branch worktree baseline"),
);

const baselineAcceptCmd = Command.make("accept", {}, accept).pipe(
	Command.withDescription("Accept the current worktree as the branch baseline"),
);

export const devBaselineCmd = Command.make("baseline").pipe(
	Command.withDescription("Manage local pre-existing worktree state"),
	Command.withSubcommands([baselineShowCmd, baselineAcceptCmd]),
);
