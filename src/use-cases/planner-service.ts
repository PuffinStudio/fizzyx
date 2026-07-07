import { Effect } from "effect";
import { ConfigError, FileError } from "../domain/errors";
import type { ProjectConfig } from "../domain/models";
import type { PlannerRuntimeApi } from "../adapters/planner-runtime";
import type { ConfigRepository } from "../ports/config-repository";
import type {
	PlannerContext,
	PlannerRepairMetadataChange,
	PlannerRepairMetadataOptions,
	PlannerRepairMetadataResult,
	PlannerSetDeadlineInput,
	PlannerSnapshot,
	PlannerSnapshotRequest,
	PlannerSnapshotRouteDecision,
	PlannerUpdateDeadlineResult,
} from "../domain/planner-model";
import { isRepairableMetadataIssue } from "../domain/planner-model";
import {
	analyzePlannerHealth,
	buildPlannerRecommendations,
	buildPlannerSummary,
} from "./planner-analytics";
import { makePlannerServiceRuntime, resolvePlannerServiceConfig } from "./planner-runtime-context";
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
import { parsePlannerDescription } from "./planner-metadata";
import { convertDescription } from "./flow-card-content";

export { analyzePlannerHealth } from "./planner-analytics";

export const buildPlannerContext = (
	config: ProjectConfig,
	runtime: PlannerRuntimeApi,
): Effect.Effect<PlannerContext, Error> =>
	runtime.listBoards(config.account).pipe(
		Effect.map((items) => items.map((board) => ({ id: board.id, name: board.name }))),
		Effect.map(
			(boards) =>
				({
					account: config.account,
					...(config.board ? { defaultBoard: config.board } : {}),
					boards,
				}) satisfies PlannerContext,
		),
	);

export const loadPlannerContext = (): Effect.Effect<
	PlannerContext,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const { config, runtime } = yield* makePlannerServiceRuntime();
		return yield* buildPlannerContext(config, runtime);
	});

export const loadPlannerSnapshot = ({
	boardId,
}: {
	readonly boardId?: string;
} = {}): Effect.Effect<PlannerSnapshot, ConfigError | FileError | Error, ConfigRepository> =>
	Effect.gen(function* () {
		const resolved = yield* resolvePlannerServiceConfig({ boardId });
		const selectedBoardId = resolved.config.board;
		if (!selectedBoardId) {
			return yield* Effect.fail(new Error("No board configured. Run: fizzyx setup <board-id>"));
		}
		const { config, runtime } = yield* makePlannerServiceRuntime({ boardId });

		const accountId = config.account;

		const [identity, board, users, columns, postponedCards, closedCards, tags] = yield* Effect.all([
			runtime.getMyIdentity().pipe(
				Effect.map((value) => toIdentityUser(value, accountId)),
				Effect.catch(() => Effect.succeed(undefined)),
			),
			runtime
				.getBoard(accountId, selectedBoardId)
				.pipe(Effect.catch(() => Effect.succeed(undefined))),
			runtime.listUsers(accountId).pipe(
				Effect.map((items) =>
					items.filter((user) => user.active).map((u) => toPlannerUser(u, accountId)),
				),
				Effect.catch(() => Effect.succeed([])),
			),
			runtime.listColumns(accountId, selectedBoardId).pipe(Effect.catch(() => Effect.succeed([]))),
			runtime.listPostponedCards(accountId, selectedBoardId),
			runtime.listClosedCards(accountId, selectedBoardId),
			runtime.listTags(accountId),
		]);
		const openCards = (yield* Effect.forEach(columns, (column) =>
			runtime
				.listColumnCards(accountId, selectedBoardId, column.id)
				.pipe(Effect.map((cards) => cards.map((card) => ({ ...card, column }))))
				.pipe(Effect.catch(() => Effect.succeed([]))),
		)).flat();
		const [streamCards, listedCards] = yield* Effect.all([
			runtime
				.listStreamCards(accountId, selectedBoardId)
				.pipe(Effect.catch(() => Effect.succeed([]))),
			runtime
				.listCards(accountId, { "board_ids[]": [selectedBoardId], all: true })
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
			board: selectedBoardId,
			boardName: board?.name || selectedBoardId,
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

const resolvePlannerSnapshotRoute = ({
	fresh,
	boardId,
}: PlannerSnapshotRequest): Effect.Effect<
	PlannerSnapshotRouteDecision,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	Effect.gen(function* () {
		if (fresh) {
			const snapshot = yield* loadPlannerSnapshot({ boardId });
			return { snapshot, triggerBackgroundRefresh: false };
		}

		const cached = yield* loadCachedPlannerSnapshot({ boardId }).pipe(
			Effect.catch(() => Effect.succeed(null)),
		);
		if (cached === null) {
			const snapshot = yield* loadPlannerSnapshot({ boardId });
			return { snapshot, triggerBackgroundRefresh: false };
		}

		return { snapshot: cached, triggerBackgroundRefresh: true };
	});

export const loadPlannerSnapshotForRequest = ({
	fresh = false,
	boardId,
}: Partial<PlannerSnapshotRequest> = {}): Effect.Effect<
	PlannerSnapshotRouteDecision,
	ConfigError | FileError | Error,
	ConfigRepository
> =>
	resolvePlannerSnapshotRoute({
		fresh,
		boardId,
	});

export const loadCachedPlannerSnapshot = ({
	boardId,
}: {
	readonly boardId?: string;
} = {}): Effect.Effect<PlannerSnapshot | null, ConfigError | FileError | Error, ConfigRepository> =>
	Effect.gen(function* () {
		const { config } = yield* resolvePlannerServiceConfig({ boardId });
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
			(change): change is PlannerRepairMetadataChange & { tags: ReadonlyArray<string> } =>
				change.action === "tag_card" && Array.isArray(change.tags),
		);

		if (options.apply) {
			yield* Effect.all(
				toApply.flatMap((change) =>
					change.tags.map((tag) => runtime.tagCard(accountId, change.cardNumber, tag)),
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
		const resolved = yield* resolvePlannerServiceConfig({ boardId: input.boardId });
		if (!resolved.config.board) {
			return yield* Effect.fail(new Error("No board configured. Run: fizzyx setup <board-id>"));
		}
		const { config, runtime } = yield* makePlannerServiceRuntime({ boardId: input.boardId });

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
		const parsed = parsePlannerDescription(rawCard.description || "");
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
