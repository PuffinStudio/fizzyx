import { Effect } from "effect";
import type { BoardColumn } from "../domain/models";
import type { Env, InitializedEnv } from "./flow-env";
import {
	BACKLOG_COLUMN_ALIASES,
	IN_PROGRESS_COLUMN_ALIASES,
	READY_COLUMN_ALIASES,
	REVIEW_COLUMN_ALIASES,
	normalizeColumnName,
} from "./flow-workflow";
import { ensureFlowConfig } from "./flow-bootstrap";

export interface DoctorResult {
	account: string;
	apiUrl: string;
	boardId: string;
	columns: { name: string; id: string; found: boolean }[];
	allColumns: ReadonlyArray<BoardColumn>;
	systemActions: ReadonlyArray<{ name: string; via: string }>;
	configUpdated: boolean;
	info: string[];
	fixes: string[];
}

const expectedColumns: ReadonlyArray<{ name: string; aliases: ReadonlyArray<string> }> = [
	{ name: "BACKLOG", aliases: BACKLOG_COLUMN_ALIASES },
	{ name: "READY", aliases: READY_COLUMN_ALIASES },
	{ name: "IN PROGRESS", aliases: IN_PROGRESS_COLUMN_ALIASES },
	{ name: "REVIEW", aliases: REVIEW_COLUMN_ALIASES },
];

export const analyzeDoctor = (env: Env): Effect.Effect<DoctorResult, unknown> =>
	Effect.gen(function* () {
		const cache = yield* env.cacheRepo.read().pipe(Effect.catch(() => Effect.succeed(null)));
		const config = env.config;
		const info: string[] = [];
		const fixes: string[] = [];
		let columnsData = cache?.columns;

		if (!columnsData || columnsData.length === 0) {
			info.push("Fetched columns from API (not cached)");
			columnsData = yield* env.api.listColumns();
		}

		const columns: DoctorResult["columns"] = [];

		for (const expectedColumn of expectedColumns) {
			const aliases = new Set(expectedColumn.aliases.map(normalizeColumnName));
			const match = columnsData.find((column) => aliases.has(normalizeColumnName(column.name)));
			if (!match) {
				columns.push({ name: expectedColumn.name, id: "", found: false });
				fixes.push(`Missing expected column "${expectedColumn.name}"`);
				continue;
			}

			columns.push({ name: expectedColumn.name, id: match.id, found: true });
		}

		const todoId = columns[0]!.id;
		const inProgressId = columns[2]!.id;

		if (!config.flow) {
			fixes.push("Flow config missing (run `fizzyx flow init` or `fizzyx flow doctor --apply`)");
		} else if (
			config.flow.columns.todo !== todoId ||
			config.flow.columns.inProgress !== inProgressId
		) {
			fixes.push("Flow column IDs in config are out of sync");
		}

		return {
			account: config.account,
			apiUrl: config.apiUrl,
			boardId: config.board ?? "(unknown)",
			columns,
			allColumns: columnsData,
			systemActions: [
				{ name: "DONE", via: "closure endpoint" },
				{ name: "NOT_NOW", via: "not_now endpoint" },
			],
			configUpdated: false,
			info,
			fixes,
		};
	});

const hasConfigChange = (before: Env["config"], after: InitializedEnv["config"]): boolean => {
	if (!before.flow) {
		return true;
	}

	if (before.flow.columns.todo !== after.flow.columns.todo) {
		return true;
	}

	if (before.flow.columns.inProgress !== after.flow.columns.inProgress) {
		return true;
	}

	return JSON.stringify(before.flow.users) !== JSON.stringify(after.flow.users);
};

export const repairDoctor = (env: Env): Effect.Effect<DoctorResult, unknown> =>
	Effect.gen(function* () {
		const before = env.config;
		const repairedConfig = yield* ensureFlowConfig({
			configRepo: env.configRepo,
			api: env.api,
			config: env.config,
			repairWorkflowColumns: true,
		});
		const repairedEnv = {
			configRepo: env.configRepo,
			cacheRepo: env.cacheRepo,
			api: env.api,
			config: repairedConfig,
		} as InitializedEnv;
		const result = yield* analyzeDoctor(repairedEnv);
		return {
			...result,
			configUpdated: hasConfigChange(before, repairedConfig),
		};
	});
