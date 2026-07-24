import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { loadConfigOptional, doctor, formatDoctor } from "../../use-cases/dev-service";

const handle = (config: { agent: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const projectConfig = yield* loadConfigOptional();
		const report = yield* doctor(projectConfig);
		yield* Console.log(formatDoctor(report, config.agent));
	});

export const devDoctorCmd = Command.make(
	"doctor",
	{
		agent: Flag.boolean("agent").pipe(Flag.withDescription("Machine-readable output for AI agents")),
	},
	handle,
).pipe(Command.withDescription("Audit workflow hygiene"));
