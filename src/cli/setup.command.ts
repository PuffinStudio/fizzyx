import { Console, Effect } from "effect";
import { withSpinner } from "./spinner";
import { renderTable } from "./render";
import { listBoards, setup } from "../use-cases/flow-service";
import type { SetupProjectConfigInput } from "../ports/config-repository";
import { hasHelp } from "./_shared/help";

export const runSetup = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		if (hasHelp(args)) {
			yield* Console.log(setupUsage());
			return;
		}

		const input = parseSetup(args);
		if (input.list) {
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

		const config = yield* withSpinner("Initializing Fizzy workflow...", setup(input));
		yield* Console.log(`created ${config.configPath}`);
	});

const setupUsage = (): string => `fizzyx setup <command>

commands:
  setup <board-id>
  setup --list`;

const parseSetup = (args: ReadonlyArray<string>): SetupProjectConfigInput => {
	const list = args.includes("--list");
	const flags = args.filter((arg) => arg.startsWith("--"));
	const positional = args.filter((arg) => !arg.startsWith("--"));

	if (list) {
		if (flags.length > 1 || positional.length > 0) {
			throw new Error("usage: fizzyx setup <board-id>");
		}
		return { list: true };
	}

	if (flags.length > 0 || positional.length !== 1) {
		throw new Error("usage: fizzyx setup <board-id>");
	}

	return { board: positional[0] };
};
