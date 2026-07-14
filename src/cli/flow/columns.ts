import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { renderTable } from "../render";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

const handleColumns = (config: { json: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const columns = yield* runWithFlowRuntimeEnv("Loading board columns...", (env) =>
			env.api.listColumns(),
		);
		yield* Console.log(
			config.json
				? flowJson(columns, `${columns.length} column(s)`, [
						{
							action: "move",
							cmd: "fizzyx flow move <card> <column-id-or-name>",
							description: "Move a card",
						},
					])
				: renderTable(columns, [
						{ header: "id", value: (column) => column.id },
						{ header: "name", value: (column) => column.name },
					]),
		);
	});

export const flowColumnsCmd = Command.make(
	"columns",
	{ json: Flag.boolean("json").pipe(Flag.withDescription("Print columns as JSON")) },
	handleColumns,
).pipe(Command.withDescription("List real columns on the configured board"));
