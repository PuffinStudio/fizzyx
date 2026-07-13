import { Effect } from "effect";
import { ConfigError, FileError, ValidationError } from "../domain/errors";
import type {
	BoardColumn,
	InitializedProjectConfig,
	ProjectConfig,
	Identity,
} from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { CONFIG_FILE } from "../ports/config-repository";
import { isTaggedErrorWithMessage } from "../_shared/helpers";
import { mergeFlowUsers } from "./flow-user-resolution";
import {
	BACKLOG_COLUMN_ALIASES,
	IN_PROGRESS_COLUMN_ALIASES,
	READY_COLUMN_ALIASES,
	normalizeColumnName,
	resolveInProgressColumnId,
	resolveTodoColumnId,
} from "./flow-workflow";

export interface FlowBootstrapExpectedColumn {
	name: string;
	id: string;
	found: boolean;
}

export interface FlowBootstrapAnalysis {
	issues: ReadonlyArray<string>;
	hasFlowConfig: boolean;
	hasLegacyFlowFields: boolean;
	shouldRepair: boolean;
	needsUserSync: boolean;
	needsWorkflowRepair: boolean;
	configuredTodo: string;
	configuredInProgress: string;
	resolvedTodo: string;
	resolvedInProgress: string;
	expectedColumns: ReadonlyArray<FlowBootstrapExpectedColumn>;
	hasReadyColumn: boolean;
	hasReviewColumn: boolean;
	mergedUsers: Record<string, string>;
}

export interface FlowBootstrapInput {
	configRepo: ConfigRepository;
	api: FizzyApi;
	config: ProjectConfig;
	initialUsers?: Record<string, string>;
	repairWorkflowColumns?: boolean;
}

const EXPECTED_COLUMNS: ReadonlyArray<{ name: string; aliases: ReadonlyArray<string> }> = [
	{ name: "BACKLOG", aliases: BACKLOG_COLUMN_ALIASES },
	{ name: "READY", aliases: READY_COLUMN_ALIASES },
	{ name: "IN PROGRESS", aliases: IN_PROGRESS_COLUMN_ALIASES },
	{ name: "REVIEW", aliases: ["REVIEW"] },
];

export const loadConfigOrDefaults = (
	configRepo: ConfigRepository,
): Effect.Effect<ProjectConfig, ConfigError | FileError> =>
	Effect.gen(function* () {
		const config = yield* configRepo.loadProjectConfigOptional().pipe(
			Effect.catchDefect((cause) =>
				isTaggedErrorWithMessage(cause, "ConfigError") && isMissingConfigError(cause.message)
					? Effect.succeed(undefined)
					: Effect.fail(cause as ConfigError | FileError),
			),
			Effect.catch((cause) =>
				isTaggedErrorWithMessage(cause, "ConfigError") && isMissingConfigError(cause.message)
					? Effect.succeed(undefined)
					: Effect.fail(cause as ConfigError | FileError),
			),
		);

		return (
			config || {
				apiUrl: "https://fizzy.puffin.studio",
				account: "1",
				configPath: `${process.cwd()}/${CONFIG_FILE}`,
				rootDir: process.cwd(),
			}
		);
	});

export const analyzeFlowConfig = (
	args: FlowBootstrapInput,
): Effect.Effect<FlowBootstrapAnalysis, unknown> =>
	Effect.gen(function* () {
		const repairWorkflowColumns = args.repairWorkflowColumns !== false;

		const identityResult = yield* args.api.identity().pipe(
			Effect.map((identity): { _tag: "success"; identity: Identity } => ({
				_tag: "success",
				identity,
			})),
			Effect.catch(() => Effect.succeed({ _tag: "failure" } as const)),
		);

		const cards = yield* args.api
			.listCards({ all: true })
			.pipe(Effect.catch(() => Effect.succeed([] as const)));
		const existingUsers = mergeFlowUsers({
			config: args.config,
			initialUsers: args.initialUsers,
			cards,
			identity: identityResult._tag === "success" ? identityResult.identity : undefined,
		});

		if (!args.config.flow) {
			const columnData = yield* args.api
				.listColumns()
				.pipe(Effect.catch(() => Effect.succeed([] as const)));
			const expectedColumns = inspectExpectedColumns(columnData);
			const issues = ["Flow config missing"];
			return {
				issues,
				hasFlowConfig: false,
				hasLegacyFlowFields: false,
				shouldRepair: true,
				needsUserSync: false,
				needsWorkflowRepair: true,
				configuredTodo: "",
				configuredInProgress: "",
				resolvedTodo: "",
				resolvedInProgress: "",
				expectedColumns,
				hasReadyColumn: expectedColumns.some((column) => column.name === "READY" && column.found),
				hasReviewColumn: expectedColumns.some((column) => column.name === "REVIEW" && column.found),
				mergedUsers: existingUsers,
			};
		}

		const currentFlowConfig = args.config.flow;
		const hasLegacyFlowFields =
			!currentFlowConfig.columns?.todo || !currentFlowConfig.columns?.inProgress;
		const columnData = yield* args.api
			.listColumns()
			.pipe(Effect.catch(() => Effect.succeed([] as const)));
		const expectedColumns = inspectExpectedColumns(columnData);
		const configuredTodo = currentFlowConfig.columns?.todo || "";
		const configuredInProgress = currentFlowConfig.columns?.inProgress || "";
		const resolvedTodo = resolveTodoColumnId(columnData, configuredTodo);
		const resolvedInProgress = resolveInProgressColumnId(columnData, configuredInProgress);
		const hasReadyColumn = expectedColumns.some(
			(column) => column.name === "READY" && column.found,
		);
		const hasReviewColumn = expectedColumns.some(
			(column) => column.name === "REVIEW" && column.found,
		);

		const needsUserSync = isUserMapChanged(currentFlowConfig.users, existingUsers);
		const userSyncIssues = needsUserSync ? ["Flow users are out of sync"] : [];

		if (!repairWorkflowColumns) {
			return {
				issues: hasLegacyFlowFields ? ["Flow columns contain legacy fields"] : userSyncIssues,
				hasFlowConfig: true,
				hasLegacyFlowFields,
				shouldRepair: hasLegacyFlowFields || needsUserSync,
				needsUserSync,
				needsWorkflowRepair: false,
				configuredTodo,
				configuredInProgress,
				resolvedTodo,
				resolvedInProgress,
				expectedColumns,
				hasReadyColumn,
				hasReviewColumn,
				mergedUsers: existingUsers,
			};
		}

		const needsWorkflowRepair =
			hasLegacyFlowFields ||
			resolvedTodo === "" ||
			resolvedInProgress === "" ||
			!hasReadyColumn ||
			!hasReviewColumn ||
			needsUserSync ||
			resolvedTodo !== configuredTodo ||
			resolvedInProgress !== configuredInProgress;

		const issues: string[] = [];
		if (hasLegacyFlowFields) issues.push("Flow columns use legacy fields");
		if (needsUserSync) issues.push("Flow users are out of sync");
		if (resolvedTodo === "") issues.push("Missing BACKLOG/TODO column in API");
		if (resolvedInProgress === "") issues.push("Missing IN PROGRESS column in API");
		if (!hasReadyColumn) issues.push("Missing READY column in API");
		if (!hasReviewColumn) issues.push("Missing REVIEW column in API");
		if (resolvedTodo !== configuredTodo) issues.push("Configured TODO column id does not resolve");
		if (resolvedInProgress !== configuredInProgress)
			issues.push("Configured IN PROGRESS column id does not resolve");

		return {
			issues,
			hasFlowConfig: true,
			hasLegacyFlowFields,
			shouldRepair: needsWorkflowRepair,
			needsUserSync,
			needsWorkflowRepair,
			configuredTodo,
			configuredInProgress,
			resolvedTodo,
			resolvedInProgress,
			expectedColumns,
			hasReadyColumn,
			hasReviewColumn,
			mergedUsers: existingUsers,
		};
	});

export const ensureFlowConfig = (
	args: FlowBootstrapInput,
): Effect.Effect<InitializedProjectConfig, unknown> =>
	analyzeFlowConfig(args).pipe(Effect.flatMap((analysis) => applyFlowConfig(args, analysis)));

export const analyzeAndApplyFlowConfig = (
	args: FlowBootstrapInput,
): Effect.Effect<
	{
		analysis: FlowBootstrapAnalysis;
		config: InitializedProjectConfig;
	},
	unknown
> =>
	Effect.gen(function* () {
		const analysis = yield* analyzeFlowConfig(args);
		const config = yield* applyFlowConfig(args, analysis);
		return { analysis, config };
	});

const applyFlowConfig = (
	args: FlowBootstrapInput,
	analysis: FlowBootstrapAnalysis,
): Effect.Effect<InitializedProjectConfig, unknown> =>
	Effect.gen(function* () {
		if (!analysis.shouldRepair) {
			return args.config as InitializedProjectConfig;
		}

		if (!args.config.flow || !analysis.hasFlowConfig || analysis.hasLegacyFlowFields) {
			if (args.repairWorkflowColumns === false) {
				return yield* new ValidationError({
					message:
						"Flow config is missing. Run 'fizzyx init' to install the Fizzyx column preset, or configure flow.columns with existing column ids.",
				});
			}
			const ensuredColumns = yield* ensureWorkflowColumns(args.api);
			return yield* args.configRepo.setupProjectConfig({
				account: args.config.account,
				board: args.config.board,
				todoColumn: ensuredColumns.backlog,
				inProgressColumn: ensuredColumns.inProgress,
				users: analysis.mergedUsers,
				apiUrl: args.config.apiUrl,
				configPath: args.config.configPath,
			});
		}

		if (args.repairWorkflowColumns === false) {
			if (!analysis.needsUserSync) {
				return args.config as InitializedProjectConfig;
			}
			return yield* args.configRepo.setupProjectConfig({
				account: args.config.account,
				board: args.config.board,
				todoColumn: args.config.flow.columns.todo,
				inProgressColumn: args.config.flow.columns.inProgress,
				users: analysis.mergedUsers,
				apiUrl: args.config.apiUrl,
				configPath: args.config.configPath,
			});
		}

		if (!analysis.needsWorkflowRepair && !analysis.needsUserSync) {
			return args.config as InitializedProjectConfig;
		}

		const ensuredColumns = yield* ensureWorkflowColumns(args.api);
		return yield* args.configRepo.setupProjectConfig({
			account: args.config.account,
			board: args.config.board,
			todoColumn: ensureValueOrExisting(
				analysis.resolvedTodo,
				args.config.flow.columns.todo,
				ensuredColumns.backlog,
			),
			inProgressColumn: ensureValueOrExisting(
				analysis.resolvedInProgress,
				args.config.flow.columns.inProgress,
				ensuredColumns.inProgress,
			),
			users: analysis.mergedUsers,
			apiUrl: args.config.apiUrl,
			configPath: args.config.configPath,
		});
	});

const ensureWorkflowColumns = (
	api: FizzyApi,
): Effect.Effect<{ backlog: string; inProgress: string }, unknown> =>
	Effect.gen(function* () {
		let columns = yield* api.listColumns();
		const backlog = yield* ensureColumn(columns, BACKLOG_COLUMN_ALIASES, () =>
			api.createColumn("TODO"),
		);
		columns = columns.some((column) => column.id === backlog)
			? columns
			: columns.concat({ id: backlog, name: "BACKLOG" });
		const ready = yield* ensureColumn(columns, READY_COLUMN_ALIASES, () =>
			api.createColumn("READY"),
		);
		columns = columns.some((column) => column.id === ready)
			? columns
			: columns.concat({ id: ready, name: "READY" });
		const inProgress = yield* ensureColumn(columns, IN_PROGRESS_COLUMN_ALIASES, () =>
			api.createColumn("INPROGRESS"),
		);
		columns = columns.some((column) => column.id === inProgress)
			? columns
			: columns.concat({ id: inProgress, name: "IN PROGRESS" });
		yield* ensureColumn(columns, ["REVIEW"] as const, () => api.createColumn("REVIEW"));
		return { backlog, inProgress };
	});

const inspectExpectedColumns = (
	columns: ReadonlyArray<BoardColumn>,
): ReadonlyArray<FlowBootstrapExpectedColumn> =>
	EXPECTED_COLUMNS.map((expectedColumn) => {
		const normalizedAliases = new Set(expectedColumn.aliases.map(normalizeColumnName));
		const match = columns.find((column) => normalizedAliases.has(normalizeColumnName(column.name)));
		return {
			name: expectedColumn.name,
			id: match?.id || "",
			found: Boolean(match),
		};
	});

const isMissingConfigError = (message: string): boolean =>
	message.startsWith(`No .fizzyx.yaml`) || message.startsWith(`No .fizzy.yaml`);

const ensureColumn = (
	columns: ReadonlyArray<{ id: string; name: string }>,
	names: ReadonlyArray<string>,
	createColumn: () => Effect.Effect<{ id: string; name: string }, unknown>,
): Effect.Effect<string, unknown> =>
	Effect.gen(function* () {
		const normalized = new Set(names.map((name) => normalizeColumnName(name)));
		const existing = columns.find((column) => normalized.has(normalizeColumnName(column.name)));
		if (existing?.id) return existing.id;

		const created = yield* createColumn();
		return created.id;
	});

const ensureValueOrExisting = (resolved: string, configured: string, fallback: string): string =>
	resolved || configured || fallback;

const isUserMapChanged = (
	current: Record<string, string>,
	next: Record<string, string>,
): boolean => {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) return true;

	for (const [key, value] of Object.entries(next)) {
		if (current[key] !== value) return true;
	}

	return false;
};
