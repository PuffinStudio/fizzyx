import { Effect } from "effect";
import { ValidationError } from "../domain/errors";
import type { BoardCache } from "../domain/models";
import type { Env, InitializedEnv } from "./flow-env";
import { buildStandardizedCommentBody } from "./flow-comment";
import {
	READY_COLUMN_ALIASES,
	REVIEW_COLUMN_ALIASES,
	isInProgressColumn,
	normalizeColumnName,
	resolveInProgressColumnId,
	resolveTodoColumnId,
} from "./flow-workflow";

export type CardTransition =
	| { kind: "move"; columnRef: string }
	| { kind: "start" }
	| { kind: "ready" }
	| { kind: "review" }
	| { kind: "close"; ref: string }
	| { kind: "block"; reason: string }
	| { kind: "unblock"; reason: string }
	| { kind: "reopen" }
	| { kind: "untriage" };

export interface CardTransitionResult {
	number: number;
	action: CardTransition["kind"];
	column?: string;
	columnId?: string;
	reason?: string;
	ref?: string;
	assigned?: boolean;
}

export interface CardTransitionOptions {
	loadFreshCache?: () => Effect.Effect<BoardCache, unknown>;
	refreshCache: () => Effect.Effect<unknown, unknown>;
}

const bestEffortRefresh = (refresh: CardTransitionOptions["refreshCache"]) =>
	refresh().pipe(Effect.catch(() => Effect.succeed(undefined)));

const verifyColumn = (env: Env, number: number, columnId: string, label: string) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		if (card.column?.id === columnId) return card;
		return yield* new ValidationError({
			message: `Card #${number} is not in ${label}. Fizzy returned no matching workflow column after the move.`,
		});
	});

const resolveNamedColumn = (env: Env, aliases: ReadonlyArray<string>, label: string) =>
	Effect.gen(function* () {
		const columns = yield* env.api.listColumns();
		const column = columns.find((item) =>
			aliases.some((alias) => normalizeColumnName(item.name) === normalizeColumnName(alias)),
		);
		if (column) return column;
		return yield* new ValidationError({
			message: `Missing ${label} column. Use 'fizzyx flow columns' to inspect this board, then use 'fizzyx flow move <card> <column>' for a custom workflow.`,
		});
	});

const moveToColumn = (
	env: Env,
	number: number,
	column: { id: string; name: string },
	options: CardTransitionOptions,
	action: CardTransitionResult["action"],
) =>
	Effect.gen(function* () {
		yield* env.api.moveCard(number, column.id);
		yield* verifyColumn(env, number, column.id, column.name);
		yield* bestEffortRefresh(options.refreshCache);
		return {
			number,
			action,
			column: column.name,
			columnId: column.id,
		} satisfies CardTransitionResult;
	});

const transitionStart = (env: InitializedEnv, number: number, options: CardTransitionOptions) =>
	Effect.gen(function* () {
		if (!options.loadFreshCache) {
			return yield* new ValidationError({
				message: "Starting a card requires initialized flow state",
			});
		}
		const cache = yield* options.loadFreshCache();
		const columnId = resolveInProgressColumnId(cache.columns, env.config.flow.columns.inProgress);
		const target = cache.cards.find((card) => card.number === number);
		if (!target) return yield* new ValidationError({ message: `Card #${number} not found` });

		const userId = cache.identity.userId;
		const active = cache.cards.filter(
			(card) =>
				(card.column?.id === columnId || isInProgressColumn(card.column?.name)) &&
				card.assignees?.some((assignee) => assignee.id === userId),
		);
		if (active.length >= env.config.flow.wipLimit) {
			return yield* new ValidationError({
				message: `Current user already has ${active.length} INPROGRESS cards`,
			});
		}

		yield* env.api.moveCard(number, columnId);
		yield* verifyColumn(env, number, columnId, "IN PROGRESS");
		const assigned = !target.assignees?.some((assignee) => assignee.id === userId);
		if (assigned) yield* env.api.assignCard(number, userId);
		yield* bestEffortRefresh(options.refreshCache);
		return {
			number,
			action: "start",
			column: "IN PROGRESS",
			columnId,
			assigned,
		} satisfies CardTransitionResult;
	});

export const transitionCard = (
	env: Env,
	number: number,
	transition: CardTransition,
	options: CardTransitionOptions,
): Effect.Effect<CardTransitionResult, unknown> => {
	switch (transition.kind) {
		case "move":
			return Effect.gen(function* () {
				const normalized = transition.columnRef.trim().toLowerCase();
				if (normalized === "done" || normalized === "closed") {
					return yield* new ValidationError({
						message: `Use 'fizzyx flow done ${number} <ref>' so completion checks cannot be bypassed`,
					});
				}
				if (normalized === "maybe" || normalized === "triage") {
					yield* env.api.untriageCard(number);
					yield* bestEffortRefresh(options.refreshCache);
					return { number, action: "untriage", column: "MAYBE", columnId: "maybe" };
				}
				if (normalized === "not-now" || normalized === "not_now") {
					yield* env.api.postponeCard(number);
					yield* bestEffortRefresh(options.refreshCache);
					return { number, action: "move", column: "NOT_NOW", columnId: "not_now" };
				}

				const columns = yield* env.api.listColumns();
				const column = columns.find(
					(item) =>
						item.id === transition.columnRef || item.name.trim().toLowerCase() === normalized,
				);
				if (!column) {
					const available = columns.map((item) => `${item.name} (${item.id})`).join(", ");
					return yield* new ValidationError({
						message: `Unknown column '${transition.columnRef}'. Available columns: ${available || "none"}`,
					});
				}
				return yield* moveToColumn(env, number, column, options, "move");
			});
		case "start":
			return transitionStart(env as InitializedEnv, number, options);
		case "ready":
			return Effect.gen(function* () {
				const column = yield* resolveNamedColumn(env, READY_COLUMN_ALIASES, "READY");
				return yield* moveToColumn(env, number, column, options, "ready");
			});
		case "review":
			return Effect.gen(function* () {
				const column = yield* resolveNamedColumn(env, REVIEW_COLUMN_ALIASES, "REVIEW");
				return yield* moveToColumn(env, number, column, options, "review");
			});
		case "close":
			return Effect.gen(function* () {
				yield* env.api.closeCard(number);
				yield* env.api
					.comment(number, buildStandardizedCommentBody("done", transition.ref))
					.pipe(Effect.catch(() => Effect.succeed(undefined)));
				yield* bestEffortRefresh(options.refreshCache);
				return { number, action: "close", ref: transition.ref };
			});
		case "block":
			return Effect.gen(function* () {
				const reason = transition.reason.trim();
				if (!reason) return yield* new ValidationError({ message: "Block reason is required" });
				yield* env.api.comment(number, buildStandardizedCommentBody("blocked", reason));
				yield* env.api.postponeCard(number);
				yield* bestEffortRefresh(options.refreshCache);
				return { number, action: "block", reason };
			});
		case "unblock":
			return Effect.gen(function* () {
				const reason = transition.reason.trim();
				if (!reason) return yield* new ValidationError({ message: "Unblock reason is required" });
				const columns = yield* env.api.listColumns();
				const columnId = resolveTodoColumnId(
					columns,
					(env as InitializedEnv).config.flow.columns.todo,
				);
				const column = columns.find((item) => item.id === columnId) ?? {
					id: columnId,
					name: "configured default column",
				};
				yield* env.api.moveCard(number, column.id);
				yield* verifyColumn(env, number, column.id, column.name);
				yield* env.api.comment(number, buildStandardizedCommentBody("unblocked", reason));
				yield* bestEffortRefresh(options.refreshCache);
				return { number, action: "unblock", reason, column: column.name, columnId: column.id };
			});
		case "reopen":
			return Effect.gen(function* () {
				yield* env.api.reopenCard(number);
				yield* bestEffortRefresh(options.refreshCache);
				return { number, action: "reopen" };
			});
		case "untriage":
			return Effect.gen(function* () {
				yield* env.api.untriageCard(number);
				yield* bestEffortRefresh(options.refreshCache);
				return { number, action: "untriage", column: "MAYBE", columnId: "maybe" };
			});
	}
};
