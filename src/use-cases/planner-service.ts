import { Effect } from "effect";
import { ConfigError, FileError } from "../domain/errors";
import { ConfigRepo, type ConfigRepository } from "../ports/config-repository";
import {
	analyzePlannerHealth,
	buildPlannerRecommendations,
	buildPlannerSummary,
} from "./planner-analytics";
import { makePlannerServiceRuntime } from "./planner-runtime-context";
import { loadPlannerSnapshotCache, writePlannerSnapshotCache } from "./planner-snapshot-cache";
import {
	mergeCards,
	planMetadataRepair,
	normalizePriority,
	renderMetadata,
	restrictUsersToConfig,
	toPlannerCard,
	toPlannerUser,
	toIdentityUser,
	toPlannerComment,
} from "./planner-transform";
import type { ParsedPlannerTags, PlannerMetadata, PlannerPriority } from "./planner-metadata";
import { parsePlannerDescription } from "./planner-metadata";
import { convertDescription } from "./flow-card-content";

export { analyzePlannerHealth } from "./planner-analytics";

export type PlannerLane = "todo" | "ready" | "in_progress" | "review" | "done" | "blocked";

export interface PlannerCard {
	number: number;
	title: string;
	lane: PlannerLane;
	column?: { id: string; name: string };
	closed: boolean;
	postponed: boolean;
	tags: ReadonlyArray<string>;
	parsedTags: ParsedPlannerTags;
	metadata: PlannerMetadata;
	metadataWarnings: ReadonlyArray<string>;
	body: string;
	assignees: ReadonlyArray<PlannerUser>;
	createdAt?: string;
	lastActiveAt?: string;
	steps: ReadonlyArray<{ id?: string; content: string; completed: boolean }>;
	comments: ReadonlyArray<PlannerComment>;
	stepProgress: { completed: number; total: number };
	url?: string;
}

export interface PlannerComment {
	id: string;
	createdAt: string;
	body: string;
	creator: PlannerUser;
}

export interface PlannerHealthIssue {
	cardNumber: number;
	title: string;
	severity: "info" | "warning" | "critical";
	code: string;
	message: string;
}

export interface PlannerRecommendation {
	cardNumber: number;
	title: string;
	reason: string;
	score: number;
}

export interface PlannerSnapshot {
	generatedAt: string;
	cache?: "fresh" | "stale";
	account: string;
	board: string;
	boardName: string;
	identity?: PlannerUser;
	users: ReadonlyArray<PlannerUser>;
	columns: ReadonlyArray<{ id: string; name: string }>;
	tags: ReadonlyArray<{ id: string; title: string }>;
	cards: ReadonlyArray<PlannerCard>;
	summary: {
		total: number;
		lanes: Record<PlannerLane, number>;
		priorities: Record<PlannerPriority, number>;
		healthIssues: number;
	};
	health: ReadonlyArray<PlannerHealthIssue>;
	recommendations: ReadonlyArray<PlannerRecommendation>;
}

export interface PlannerUser {
	id: string;
	name: string;
	avatarUrl?: string;
}

export interface PlannerRepairMetadataOptions {
	apply: boolean;
	defaultPriority?: PlannerPriority;
	defaultType?: string;
}

export interface PlannerRepairMetadataChange {
	cardNumber: number;
	title: string;
	action: "update_description" | "skip";
	reason: string;
	description?: string;
}

export interface PlannerUpdateDeadlineResult {
	cardNumber: number;
	deadline: string | null;
}

export interface PlannerSetDeadlineInput {
	cardNumber: number;
	deadline?: string;
}

const REPAIRABLE_METADATA_ISSUE_CODES = new Set([
	"missing_priority",
	"invalid_priority",
	"missing_type",
	"missing_owner",
	"multiple_priority",
]);

const isRepairableMetadataIssue = (issue: PlannerHealthIssue): boolean =>
	REPAIRABLE_METADATA_ISSUE_CODES.has(issue.code);

export interface PlannerRepairMetadataResult {
	applied: boolean;
	changes: ReadonlyArray<PlannerRepairMetadataChange>;
}

export const loadPlannerSnapshot = (): Effect.Effect<
	PlannerSnapshot,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const { config, runtime } = yield* makePlannerServiceRuntime();
		if (!config.board) {
			return yield* Effect.fail(new Error("No board configured. Run: fizzyx setup <board-id>"));
		}

		const accountId = config.account;
		const boardId = config.board;

		const [identity, board, users, columns, postponedCards, closedCards, tags] = yield* Effect.all([
			runtime.getMyIdentity().pipe(
				Effect.map((value) => toIdentityUser(value, accountId)),
				Effect.catch(() => Effect.succeed(undefined)),
			),
			runtime.getBoard(accountId, boardId).pipe(Effect.catch(() => Effect.succeed(undefined))),
			runtime.listUsers(accountId).pipe(
				Effect.map((items) =>
					items.filter((user) => user.active).map((u) => toPlannerUser(u, accountId)),
				),
				Effect.catch(() => Effect.succeed([])),
			),
			runtime.listColumns(accountId, boardId).pipe(Effect.catch(() => Effect.succeed([]))),
			runtime.listPostponedCards(accountId, boardId),
			runtime.listClosedCards(accountId, boardId),
			runtime.listTags(accountId),
		]);
		const openCards = (yield* Effect.forEach(columns, (column) =>
			runtime
				.listColumnCards(accountId, boardId, column.id)
				.pipe(Effect.map((cards) => cards.map((card) => ({ ...card, column }))))
				.pipe(Effect.catch(() => Effect.succeed([]))),
		)).flat();
		const [streamCards, listedCards] = yield* Effect.all([
			runtime.listStreamCards(accountId, boardId).pipe(Effect.catch(() => Effect.succeed([]))),
			runtime
				.listCards(accountId, { "board_ids[]": [boardId], all: true })
				.pipe(Effect.catch(() => Effect.succeed([]))),
		]);

		const detailedCards = yield* Effect.forEach(
			mergeCards([...listedCards, ...streamCards, ...openCards], postponedCards, closedCards),
			(card) =>
				runtime.getCard(accountId, card.number).pipe(
					Effect.catch(() => Effect.succeed(card)),
					Effect.map((detail) => ({
						...card,
						...detail,
						closed: card.closed || detail.closed,
						postponed: card.postponed || detail.postponed,
						column: detail.column || card.column,
					})),
				),
		);
		const cardsWithoutComments = detailedCards.map((card) =>
			toPlannerCard(card, columns, accountId),
		);
		const cards = yield* Effect.forEach(cardsWithoutComments, (card) =>
			runtime.listComments(accountId, card.number).pipe(
				Effect.catch(() => Effect.succeed([])),
				Effect.map((comments) => ({
					...card,
					comments: comments.slice(-5).map((c) => toPlannerComment(c, accountId)),
				})),
			),
		);
		const health = analyzePlannerHealth(cards);
		const recommendations = buildPlannerRecommendations(cards, health);

		const visibleUsers = restrictUsersToConfig(users, identity, config.flow?.users);

		const snapshot = {
			generatedAt: new Date().toISOString(),
			cache: "fresh",
			account: accountId,
			board: boardId,
			boardName: board?.name || boardId,
			identity,
			users: visibleUsers,
			columns: columns.map((column) => ({ id: column.id, name: column.name })),
			tags: tags.map((tag) => ({ id: tag.id, title: tag.title })),
			cards,
			summary: buildPlannerSummary(cards, health),
			health,
			recommendations,
		} satisfies PlannerSnapshot;
		yield* writePlannerSnapshotCache(snapshot).pipe(Effect.catch(() => Effect.succeed(undefined)));
		return snapshot;
	});

export interface PlannerSnapshotRouteDecision {
	snapshot: PlannerSnapshot;
	triggerBackgroundRefresh: boolean;
}

export interface PlannerSnapshotRequest {
	fresh: boolean;
}

const resolvePlannerSnapshotRoute = ({
	fresh,
}: PlannerSnapshotRequest): Effect.Effect<
	PlannerSnapshotRouteDecision,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	Effect.gen(function* () {
		if (fresh) {
			const snapshot = yield* loadPlannerSnapshot();
			return { snapshot, triggerBackgroundRefresh: false };
		}

		const cached = yield* loadCachedPlannerSnapshot().pipe(
			Effect.catch(() => Effect.succeed(null)),
		);
		if (cached === null) {
			const snapshot = yield* loadPlannerSnapshot();
			return { snapshot, triggerBackgroundRefresh: false };
		}

		return { snapshot: cached, triggerBackgroundRefresh: true };
	});

export const loadPlannerSnapshotForRequest = ({
	fresh = false,
}: Partial<PlannerSnapshotRequest> = {}): Effect.Effect<
	PlannerSnapshotRouteDecision,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	resolvePlannerSnapshotRoute({
		fresh,
	});

export const loadCachedPlannerSnapshot = (): Effect.Effect<
	PlannerSnapshot | null,
	ConfigError | FileError,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		if (!config.board) return null;
		const cached = yield* loadPlannerSnapshotCache(config.account, config.board);
		if (cached === null) return null;
		return cached;
	});

export const repairPlannerMetadata = (
	options: PlannerRepairMetadataOptions,
): Effect.Effect<PlannerRepairMetadataResult, ConfigError | FileError | Error, ConfigRepository> =>
	Effect.gen(function* () {
		const { config, runtime } = yield* makePlannerServiceRuntime();
		if (!config.board) {
			return yield* Effect.fail(new Error("No board configured. Run: fizzyx setup <board-id>"));
		}

		const accountId = config.account;
		const boardId = config.board;
		const [openCards, postponedCards, closedCards] = yield* Effect.all([
			runtime.listCards(accountId, { "board_ids[]": [boardId], all: true }),
			runtime.listPostponedCards(accountId, boardId),
			runtime.listClosedCards(accountId, boardId),
		]);
		const cards = mergeCards(openCards, postponedCards, closedCards);
		const detailedCards = yield* Effect.forEach(cards, (card) =>
			runtime.getCard(accountId, card.number).pipe(
				Effect.catch(() => Effect.succeed(card)),
				Effect.map((detail) => ({
					...card,
					...detail,
					closed: card.closed || detail.closed,
					postponed: card.postponed || detail.postponed,
					column: detail.column || card.column,
				})),
			),
		);
		const plannerCards = detailedCards.map((card) => toPlannerCard(card, [], accountId));
		const detailedCardsByNumber = new Map(
			detailedCards.map((card) => [card.number, card] as const),
		);
		const repairableCardNumbers = new Set(
			analyzePlannerHealth(plannerCards)
				.filter(isRepairableMetadataIssue)
				.map((issue) => issue.cardNumber),
		);
		const changes = cards.map((card) => {
			if (!repairableCardNumbers.has(card.number)) {
				return {
					cardNumber: card.number,
					title: card.title,
					action: "skip",
					reason: "not repairable",
				} satisfies PlannerRepairMetadataChange;
			}

			const detail = detailedCardsByNumber.get(card.number) || card;
			return planMetadataRepair(detail, options, normalizePriority);
		});
		const toApply = changes.filter(
			(change): change is PlannerRepairMetadataChange & { description: string } =>
				change.action === "update_description" && typeof change.description === "string",
		);

		if (options.apply) {
			yield* Effect.all(
				toApply.map((change) =>
					runtime.updateCard(accountId, change.cardNumber, change.description),
				),
				{ concurrency: 8 },
			);
		}

		return { applied: options.apply, changes } satisfies PlannerRepairMetadataResult;
	});

export const setPlannerCardDeadline = (
	input: PlannerSetDeadlineInput,
): Effect.Effect<PlannerUpdateDeadlineResult, ConfigError | FileError | Error, ConfigRepository> =>
	Effect.gen(function* () {
		const { config, runtime } = yield* makePlannerServiceRuntime();
		if (!config.board) {
			return yield* Effect.fail(new Error("No board configured. Run: fizzyx setup <board-id>"));
		}

		if (!Number.isInteger(input.cardNumber) || input.cardNumber <= 0) {
			return yield* Effect.fail(new Error("Invalid card number"));
		}

		const accountId = config.account;
		const rawCard = yield* runtime
			.getCard(accountId, input.cardNumber)
			.pipe(
				Effect.catch(() =>
					Effect.fail(new Error(`Could not load planner card #${input.cardNumber}`)),
				),
			);
		const parsed = parsePlannerDescription(rawCard.description_html || rawCard.description);
		const deadline = normalizeDeadlineInput(input.deadline);

		const metadata = {
			...parsed.metadata,
			...(deadline ? { deadline } : {}),
		};
		if (deadline === null) {
			delete metadata.deadline;
		}

		const nextDescription = convertDescription(
			`${renderMetadata(metadata)}${parsed.body ? `\n${parsed.body}` : ""}`.trimEnd(),
		);
		yield* runtime.updateCard(accountId, input.cardNumber, nextDescription);

		return { cardNumber: input.cardNumber, deadline } satisfies PlannerUpdateDeadlineResult;
	});

const normalizeDeadlineInput = (value?: string): string | null => {
	const raw = value?.trim();
	if (!raw) return null;
	return raw;
};
