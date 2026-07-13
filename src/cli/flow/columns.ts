import { Console, Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { renderTable } from "../render";
import { runWithFlowRuntimeEnv } from "../flow-workflow";

const handleColumns = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const columns = yield* runWithFlowRuntimeEnv("Loading board columns...", (env) =>
			env.api.listColumns(),
		);
		yield* Console.log(
			renderTable(columns, [
				{ header: "id", value: (column) => column.id },
				{ header: "name", value: (column) => column.name },
			]),
		);
	});

export const flowColumnsCmd = Command.make("columns", {}, handleColumns).pipe(
	Command.withDescription("List real columns on the configured board"),
);
