import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { listBoards, setup } from "../use-cases/flow-service";
import { renderTable } from "./render";
import { withSpinner, logSuccess } from "./ui";

const handleSetup = (config: {
	list: boolean;
	boardId: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.list) {
			const boards = yield* withSpinner("Loading Fizzy boards...", listBoards());
			if (boards.length === 0) {
				yield* Console.log("(no boards)");
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
			yield* Console.log("usage: fizzyx setup <board-id>\n       fizzyx setup --list");
			return;
		}

		const configResult = yield* withSpinner(
			"Initializing Fizzy workflow...",
			setup({ board: config.boardId.value }),
		);
		yield* logSuccess(`created ${configResult.configPath}`);
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
