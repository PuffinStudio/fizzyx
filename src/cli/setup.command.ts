import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { listBoards, setup } from "../use-cases/flow-service";
import { renderTable } from "./render";
import {
	formatInitializingWorkflowMessage,
	formatLoadingBoardsMessage,
	formatNoBoards,
	formatSetupCreatedConfig,
	formatSetupUsage,
} from "./setup-output";
import { withSpinner, logSuccess } from "./ui";

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
			yield* Console.log(formatSetupUsage());
			return;
		}

		const configResult = yield* withSpinner(
			formatInitializingWorkflowMessage(),
			setup({ board: config.boardId.value }),
		);
		yield* logSuccess(formatSetupCreatedConfig(configResult.configPath));
	});

export const setupCmd = Command.make(
	"setup",
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
