import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { bootstrapFlowConfig, listBoards, setup } from "../use-cases/flow-service";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { renderTable } from "./render";
import {
	formatInitializingWorkflowMessage,
	formatLoadingBoardsMessage,
	formatNoBoards,
	formatSetupCreatedConfig,
	formatSetupUsage,
} from "./setup-output";
import {
	formatFlowConfigMissing,
	formatFlowConfigured,
	formatInitializingWorkflowConfigMessage,
} from "./flow-output";
import { withSpinner, logSuccess } from "./ui";
import { runWithFlowRuntimeEnv } from "./flow-workflow";

const handleSetup = (config: {
	list: boolean;
	boardId: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.list) {
			const boards = yield* withSpinner(formatLoadingBoardsMessage(), listBoards());
			if (boards.length === 0) {
				yield* Console.log(formatNoBoards());
				return;
			}

			yield* Console.log(
				renderTable(boards, [
					{ header: "id", value: (board) => board.id },
					{ header: "name", value: (board) => board.name },
				]),
			);
			return;
		}

		if (Option.isNone(config.boardId)) {
			if (!hasProjectConfig()) {
				yield* Console.log(formatSetupUsage());
				return;
			}

			const initialized = yield* runWithFlowRuntimeEnv(
				formatInitializingWorkflowConfigMessage(),
				(env) =>
					Effect.gen(function* () {
						const hadMissingConfig = !env.config.flow;
						return {
							hadMissingConfig,
							initializedConfig: yield* bootstrapFlowConfig(env, {
								repairWorkflowColumns: hadMissingConfig,
							}),
						};
					}),
			).pipe(Effect.catch(() => Effect.succeed(undefined)));

			if (initialized) {
				if (initialized.hadMissingConfig) {
					yield* Console.log(formatFlowConfigMissing());
				}
				yield* Console.log(
					formatFlowConfigured(
						initialized.initializedConfig.flow.columns.todo,
						initialized.initializedConfig.flow.columns.inProgress,
					),
				);
				return;
			}

			yield* Console.log(formatSetupUsage());
			return;
		}

		const configResult = yield* withSpinner(
			formatInitializingWorkflowMessage(),
			setup({ board: config.boardId.value }),
		);
		yield* logSuccess(formatSetupCreatedConfig(configResult.configPath));
	});

const hasProjectConfig = (): boolean => {
	let dir = process.cwd();
	while (true) {
		if (existsSync(join(dir, CONFIG_FILE)) || existsSync(join(dir, LEGACY_CONFIG_FILE))) {
			return true;
		}
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
};

export const setupCmd = Command.make(
	"init",
	{
		list: Flag.boolean("list").pipe(Flag.withDescription("List available Fizzy boards")),
		boardId: Argument.string("board-id").pipe(
			Argument.withDescription("Board ID to initialize"),
			Argument.withMetavar("BOARD_ID"),
			Argument.optional,
		),
	},
	handleSetup,
).pipe(Command.withDescription("Initialize or list Fizzy workspace"));
