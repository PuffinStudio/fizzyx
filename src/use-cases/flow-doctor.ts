import { Effect } from "effect";
import type { BoardColumn } from "../domain/models";
import type { Env, InitializedEnv } from "./flow-env";
import { normalizeColumnName } from "./flow-workflow";
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

export const analyzeDoctor = (env: Env): Effect.Effect<DoctorResult, unknown> =>
	Effect.gen(function* () {
		const config = env.config;
		const info: string[] = [];
		const fixes: string[] = [];
		info.push("Fetched columns from API");
		info.push(
			"Tag metadata health is reported by `fizzyx flow work` and repaired by `fizzyx flow repair`",
		);
		info.push("Skill pins are checked by `fizzyx skill doctor`");
		const columnsData = yield* env.api.listColumns();

		if (!config.flow) {
			fixes.push("Flow config missing (run `fizzyx init` or `fizzyx flow doctor --apply`)");
		}

		const configuredColumns = config.flow
			? [
					{ name: "DEFAULT", id: config.flow.columns.todo },
					{ name: "IN PROGRESS", id: config.flow.columns.inProgress },
				]
			: [];
		const columns = configuredColumns.map((configured) => {
			const match = columnsData.find((column) => column.id === configured.id);
			if (!match)
				fixes.push(`Configured ${configured.name} column id '${configured.id}' was not found`);
			return {
				name: match?.name ?? configured.name,
				id: configured.id,
				found: Boolean(match),
			};
		});
		const presetColumns = new Set(columnsData.map((column) => normalizeColumnName(column.name)));
		if (presetColumns.has("ready") || presetColumns.has("review")) {
			info.push("Detected optional Fizzyx preset columns");
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
			repairWorkflowColumns: !env.config.flow,
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
