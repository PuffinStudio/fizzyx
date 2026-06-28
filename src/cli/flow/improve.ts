import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { formatImproveGuidance } from "../flow-output";

const handleImprove = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* Console.log(formatImproveGuidance());
	});

export const flowImproveCmd = Command.make("improve", {}, handleImprove).pipe(
	Command.withDescription("Review improvement candidates"),
);
