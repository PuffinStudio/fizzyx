import { Console, Effect, Option } from "effect";
import { Command, Flag, Argument } from "effect/unstable/cli";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { bootstrapFlowConfig, listBoards, setup } from "../use-cases/flow-service";
import { syncAgentInstructions } from "../use-cases/agent-instructions";
import {
	scanWorkspaceMembers,
	syncWorkspaceInstructions,
	type WorkspaceMember,
} from "../use-cases/workspace-instructions";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { renderTable } from "./render";
import {
	formatInitializingWorkflowMessage,
	formatAgentInstructionsSynced,
	formatLoadingBoardsMessage,
	formatNoBoards,
	formatSetupCreatedConfig,
	formatSetupUsage,
	formatWorkspaceNoMembers,
	formatWorkspaceNoSelection,
	formatWorkspaceSummary,
} from "./setup-output";
import {
	formatFlowConfigMissing,
	formatFlowConfigured,
	formatInitializingWorkflowConfigMessage,
} from "./flow-output";
import { withSpinner, logSuccess } from "./ui";
import { runWithFlowRuntimeEnv } from "./flow-workflow";

const promptLine = (message: string): Effect.Effect<string, any, any> =>
	Effect.tryPromise({
		try: () =>
			new Promise<string>((resolve) => {
				const rl = require("node:readline").createInterface({
					input: process.stdin,
					output: process.stderr,
				});
				rl.question(message, (value: string) => {
					rl.close();
					resolve(value.trim());
				});
			}),
		catch: (cause) => new Error(String(cause)),
	});

export const parseToggleSelection = (input: string, count: number): ReadonlyArray<number> => {
	const indices = new Set<number>();
	for (const token of input.split(/[\s,]+/).filter(Boolean)) {
		const n = Number(token);
		if (Number.isInteger(n) && n >= 1 && n <= count) indices.add(n - 1);
	}
	return [...indices];
};

const defaultSelection = (members: ReadonlyArray<WorkspaceMember>): boolean[] => {
	const anyConfigured = members.some((m) => m.configured);
	return members.map((m) => (anyConfigured ? m.configured : true));
};

const selectMembers = (
	members: ReadonlyArray<WorkspaceMember>,
): Effect.Effect<ReadonlyArray<WorkspaceMember>, any, any> =>
	Effect.gen(function* () {
		const selected = defaultSelection(members);
		if (!process.stdin.isTTY) {
			return members.filter((_, i) => selected[i]);
		}

		const render = () =>
			members
				.map((m, i) => {
					const mark = selected[i] ? "x" : " ";
					const tag = m.configured ? `fizzyx${m.board ? ` board ${m.board}` : ""}` : "no config";
					return `  [${mark}] ${i + 1}) ${m.name}/  (${tag})`;
				})
				.join("\n");

		process.stderr.write(
			`Select workspace folders (pre-checked = has .fizzyx.yaml):\n${render()}\n`,
		);
		const answer = yield* promptLine(
			"Toggle numbers (space/comma separated), or press Enter to accept: ",
		);
		for (const index of parseToggleSelection(answer, members.length)) {
			selected[index] = !selected[index];
		}
		return members.filter((_, i) => selected[i]);
	});

const handleWorkspaceInit = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const rootDir = process.cwd();
		const members = scanWorkspaceMembers(rootDir);
		if (members.length === 0) {
			yield* Console.log(formatWorkspaceNoMembers());
			return;
		}

		const selected = yield* selectMembers(members);
		if (selected.length === 0) {
			yield* Console.log(formatWorkspaceNoSelection());
			return;
		}

		const result = syncWorkspaceInstructions(rootDir, selected);
		yield* Console.log(formatAgentInstructionsSynced(result.action, result.path));
		yield* Console.log(formatWorkspaceSummary(selected));
	});

const handleSetup = (config: {
	list: boolean;
	boardId: Option.Option<string>;
	workspace: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		if (config.workspace) {
			return yield* handleWorkspaceInit();
		}

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
				const agents = syncAgentInstructions(initialized.initializedConfig.rootDir);
				yield* Console.log(formatAgentInstructionsSynced(agents.action, agents.path));
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
		const agents = syncAgentInstructions(configResult.rootDir);
		yield* Console.log(formatAgentInstructionsSynced(agents.action, agents.path));
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
		workspace: Flag.boolean("workspace").pipe(
			Flag.withDescription(
				"Generate a multi-project workspace AGENTS.md by selecting sibling folders",
			),
		),
		boardId: Argument.string("board-id").pipe(
			Argument.withDescription("Board ID to initialize"),
			Argument.withMetavar("BOARD_ID"),
			Argument.optional,
		),
	},
	handleSetup,
).pipe(Command.withDescription("Initialize Fizzy workspace and project agent instructions"));
