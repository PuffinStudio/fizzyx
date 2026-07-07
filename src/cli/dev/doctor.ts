import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { loadConfig, doctor, formatDoctor } from "../../use-cases/dev-service";

const handle = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const projectConfig = yield* loadConfig().pipe(Effect.catch(() => Effect.succeed(undefined)));
		const report = yield* doctor(projectConfig ?? undefined);
		yield* Console.log(formatDoctor(report));
	});

export const devDoctorCmd = Command.make("doctor", {}, handle).pipe(
	Command.withDescription("Audit workflow hygiene"),
);
