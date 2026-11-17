import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { done } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import {
  formatClosingCardMessage,
  formatCompleteStepsSummary,
  formatClosedCard,
  formatCompletedSteps,
} from "../flow-output";
import { flowJson } from "../flow-json";

const handleDone = (config: {
  card: number;
  ref: Option.Option<string>;
  completeSteps: boolean;
  json: boolean;
}): Effect.Effect<void, any, any> =>
  Effect.gen(function* () {
    const note = Option.getOrUndefined(config.ref);
    const result = yield* runWithFlowEnv(formatClosingCardMessage(), (env) =>
      done(env, config.card, note, { completeSteps: config.completeSteps }),
    );

    if (config.json) {
      yield* Console.log(flowJson(result, formatClosedCard(result.number, result.ref)));
      return;
    }

    if (result.completedSteps && result.completedSteps.updatedCount > 0) {
      yield* Console.log(
        formatCompleteStepsSummary(result.completedSteps.updatedCount, result.number),
      );
      if (result.completedSteps.contents.length > 0) {
        yield* Console.log(formatCompletedSteps(result.completedSteps.contents));
      }
    }

    yield* Console.log(formatClosedCard(result.number, result.ref));
  });

export const flowDoneCmd = Command.make(
  "done",
  {
    card: Argument.integer("card").pipe(
      Argument.withDescription("Card number"),
      Argument.withMetavar("CARD"),
    ),
    ref: Argument.string("note").pipe(
      Argument.withDescription("Closing note recorded as a comment on the card"),
      Argument.optional,
    ),
    completeSteps: Flag.boolean("complete-steps").pipe(
      Flag.withDescription("Complete pending steps before closing"),
    ),
    json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
  },
  handleDone,
).pipe(Command.withDescription("Close a card"));
