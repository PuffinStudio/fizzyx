import { Effect } from "effect";
import type { BoardColumn } from "../domain/models";
import { ValidationError } from "../domain/errors";

export const BACKLOG_COLUMN_ALIASES = ["BACKLOG", "TODO"] as const;
export const READY_COLUMN_ALIASES = ["READY"] as const;
export const IN_PROGRESS_COLUMN_ALIASES = ["IN PROGRESS", "INPROGRESS"] as const;
export const REVIEW_COLUMN_ALIASES = ["REVIEW"] as const;

export const normalizeColumnName = (name: string): string =>
	name.trim().toLowerCase().replace(/\s+/g, "");

const BACKLOG_COLUMN_NAME_SET = new Set(
	BACKLOG_COLUMN_ALIASES.map((name) => normalizeColumnName(name)),
);
const IN_PROGRESS_COLUMN_NAME_SET = new Set(IN_PROGRESS_COLUMN_ALIASES.map(normalizeColumnName));
const READY_COLUMN_NAME_SET = new Set(READY_COLUMN_ALIASES.map(normalizeColumnName));
const REVIEW_COLUMN_NAME_SET = new Set(REVIEW_COLUMN_ALIASES.map(normalizeColumnName));

export const resolveTodoColumnId = (
	cards: ReadonlyArray<BoardColumn> | undefined,
	configuredColumnId: string,
): string => {
	if (!cards) {
		return configuredColumnId;
	}

	const byId = cards.find((column) => column.id === configuredColumnId);
	if (byId && isTodoColumn(byId.name)) {
		return byId.id;
	}

	for (const alias of BACKLOG_COLUMN_ALIASES) {
		const backlogColumn = cards.find(
			(column) => normalizeColumnName(column.name) === normalizeColumnName(alias),
		);
		if (backlogColumn) {
			return backlogColumn.id;
		}
	}

	return configuredColumnId;
};

export const resolveInProgressColumnId = (
	columns: ReadonlyArray<BoardColumn>,
	configuredColumnId: string,
): string => {
	const byId = columns.find((column) => column.id === configuredColumnId);
	if (byId) {
		return byId.id;
	}

	const inProgressColumn = columns.find((column) => isInProgressColumn(column.name));

	return inProgressColumn ? inProgressColumn.id : configuredColumnId;
};

export const resolveReadyColumnId = (
	columns: ReadonlyArray<BoardColumn>,
	configuredTodoColumnId: string,
): string | null => {
	const readyColumn = columns.find((column) =>
		READY_COLUMN_NAME_SET.has(normalizeColumnName(column.name)),
	);
	if (readyColumn) {
		return readyColumn.id;
	}

	const todoColumnId = resolveTodoColumnId(columns, configuredTodoColumnId);
	return todoColumnId || null;
};

export const isTodoColumn = (name?: string): boolean => {
	if (!name) {
		return false;
	}

	return BACKLOG_COLUMN_NAME_SET.has(normalizeColumnName(name));
};

export const isInProgressColumn = (name?: string): boolean => {
	if (!name) {
		return false;
	}

	return IN_PROGRESS_COLUMN_NAME_SET.has(normalizeColumnName(name));
};

export const isReadyColumn = (name?: string): boolean => {
	if (!name) {
		return false;
	}

	return READY_COLUMN_NAME_SET.has(normalizeColumnName(name));
};

export const isReviewColumn = (name?: string): boolean => {
	if (!name) {
		return false;
	}

	return REVIEW_COLUMN_NAME_SET.has(normalizeColumnName(name));
};

export interface WorkflowMoveContext {
	listColumns: () => Effect.Effect<ReadonlyArray<BoardColumn>, unknown>;
	moveCard: (number: number, columnId: string) => Effect.Effect<unknown, unknown>;
}

export const moveToWorkflowColumn = (
	context: WorkflowMoveContext,
	number: number,
	aliases: ReadonlyArray<string>,
	label: string,
	reload: () => Effect.Effect<unknown, unknown>,
): Effect.Effect<{ number: number; column: string }, ValidationError | unknown> =>
	Effect.gen(function* () {
		const columns = yield* context.listColumns();
		const column = columns.find((item) =>
			aliases.some((alias) => normalizeColumnName(item.name) === normalizeColumnName(alias)),
		);
		if (!column) {
			return yield* new ValidationError({
				message: `Missing ${label} column. I will try repairing flow configuration on next command run.`,
			});
		}
		yield* context.moveCard(number, column.id);
		yield* reload();
		return { number, column: column.name };
	});
