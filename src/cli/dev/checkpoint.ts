import { Console, Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { checkpoint } from "../../use-cases/dev-service";
import { logSuccess } from "../ui";

const handle = (config: {
  message: Option.Option<string>;
  all: boolean;
  allowProtected: boolean;
  agent: boolean;
}): Effect.Effect<void, any, any> =>
  Effect.gen(function* () {
    const msg = yield* checkpoint(
      Option.getOrElse(config.message, () => undefined),
      config.all,
      config.allowProtected,
    );
    if (config.agent) {
      const checkpointed = !msg.startsWith("No changes");
      yield* Console.log(
        [`checkpointed: ${checkpointed ? "yes" : "no"}`, `message: ${msg}`].join("\n"),
      );
      return;
    }
    yield* logSuccess(msg);
  });

export const devCheckpointCmd = Command.make(
  "checkpoint",
  {
    message: Flag.optional(
      Flag.string("message").pipe(
        Flag.withDescription("Commit message (auto-generates wip: if omitted)"),
      ),
    ),
    all: Flag.boolean("all").pipe(
      Flag.withDescription(
        "Stage everything before committing, including pre-existing changes you did not make and untracked files (default: only files this task touched)",
      ),
    ),
    allowProtected: Flag.boolean("allow-protected").pipe(
      Flag.withDescription("Commit even on a protected branch or a detached HEAD"),
    ),
    agent: Flag.boolean("agent").pipe(
      Flag.withDescription("Machine-readable output for AI agents"),
    ),
  },
  handle,
).pipe(Command.withDescription("Create a local checkpoint commit"));
