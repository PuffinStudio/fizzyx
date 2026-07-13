import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { ready, formatReady } from "../../use-cases/dev-service";
import { ValidationError } from "../../domain/errors";

const handle = (config: {
	full: boolean;
	agent: boolean;
	squash: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* ready(config.full, config.squash);
		yield* Console.log(formatReady(result, config.agent));
		if (!result.ready) {
			return yield* new ValidationError({ message: "Branch is not ready" });
		}
	});

export const devReadyCmd = Command.make(
	"ready",
	{
		full: Flag.boolean("full").pipe(
			Flag.withDescription("Run full check suite (slower, more thorough)"),
		),
		agent: Flag.boolean("agent").pipe(
			Flag.withDescription("Machine-readable output for AI agents"),
		),
		squash: Flag.boolean("squash").pipe(
			Flag.withDescription("Squash checkpoint WIP commits into one reviewable commit"),
		),
	},
	handle,
).pipe(Command.withDescription("Check branch readiness for review or promotion"));
