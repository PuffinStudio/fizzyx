import { Console, Effect } from "effect";
import { Flag, Command } from "effect/unstable/cli";
import { analyzeDoctor, repairDoctor } from "../../use-cases/flow-service";
import { formatCheckingFlowHealthMessage, formatDoctorResult } from "../flow-output";
import { runWithFlowRuntimeEnv } from "../flow-workflow";

const handleDoctor = (config: { apply: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* runWithFlowRuntimeEnv(
			formatCheckingFlowHealthMessage(),
			config.apply ? repairDoctor : analyzeDoctor,
		);
		yield* Console.log(formatDoctorResult(result, { applied: config.apply }));
	});

export const flowDoctorCmd = Command.make(
	"doctor",
	{
		apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply flow health fixes")),
	},
	handleDoctor,
).pipe(Command.withDescription("Check flow health"));
