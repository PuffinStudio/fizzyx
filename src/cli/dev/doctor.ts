import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { doctor, formatDoctor, loadConfigOptional } from "../../use-cases/dev-service";

const handle = (config: { agent: boolean; verbose: boolean }): Effect.Effect<void, any, any> =>
  Effect.gen(function* () {
    const projectConfig = yield* loadConfigOptional();
    const report = yield* doctor(projectConfig);
    yield* Console.log(formatDoctor(report, config.agent, config.verbose));
  });

export const devDoctorCmd = Command.make(
  "doctor",
  {
    agent: Flag.boolean("agent").pipe(
      Flag.withDescription("Machine-readable output for AI agents"),
    ),
    verbose: Flag.boolean("verbose").pipe(
      Flag.withDescription("List the branches in every section instead of only the counts"),
    ),
  },
  handle,
).pipe(Command.withDescription("Audit workflow hygiene"));
