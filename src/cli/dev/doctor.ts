import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { loadConfigOptional, doctor, formatDoctor } from "../../use-cases/dev-service";

const handle = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const projectConfig = yield* loadConfigOptional();
		const report = yield* doctor(projectConfig);
		yield* Console.log(formatDoctor(report));
	});

export const devDoctorCmd = Command.make("doctor", {}, handle).pipe(
	Command.withDescription("Audit workflow hygiene"),
);
