import { Effect, Layer } from "effect";
import * as HttpClient from "effect/unstable/http/HttpClient";
import { ApiError } from "../domain/errors";
import type {
	Assignee,
	Board,
	BoardColumn,
	Card,
	Comment,
	Identity,
	ProjectConfig,
	ColumnRef,
	Step,
} from "../domain/models";
import { FizzyApi } from "../ports/fizzy-api";
import { ConfigRepo } from "../ports/config-repository";
import * as FizzyEffect from "../fizzy-effect/effect-client";
import type { EffectHttpClientError } from "../fizzy-effect/effect-client";
import type { UpdateStepRequestContent } from "../fizzy-effect/types";

export const Live = Layer.effect(FizzyApi)(
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		const credentials = yield* configRepo
			.loadCredentials(config.account)
			.pipe(
				Effect.catch(() =>
					Effect.fail(new ApiError({ message: "Not logged in. Run: fizzyx auth login" })),
				),
			);
		return makeFetchFizzyApi(config, credentials.token);
	}),
);

type JsonObject = Record<string, unknown>;
type JsonValue = unknown;

export const makeFetchFizzyApi = (config: ProjectConfig, token: string): FizzyApi => {
	const configureGeneratedClient = (): void => {
		FizzyEffect.configure({
			baseUrl: config.apiUrl.replace(/\/+$/, ""),
			responseExtractor: envelopeData,
		});
		FizzyEffect.setToken(token);
	};

	const runGenerated = <A>(
		effect: Effect.Effect<A, EffectHttpClientError, HttpClient.HttpClient>,
	): Effect.Effect<A, ApiError> =>
		Effect.sync(configureGeneratedClient).pipe(
			Effect.flatMap(() => effect),
			Effect.provide(FizzyEffect.FetchLayer),
			Effect.mapError(toApiError),
		);

	const toApiError = (cause: unknown): ApiError => {
		if (cause instanceof ApiError) return cause;
		const error = toRecord(cause);
		const reason = toRecord(error?.reason);
		const response = toRecord(reason?.response) || toRecord(error?.response);
		const status = readFiniteNumber(response?.status);
		if (Number.isFinite(status)) {
			return new ApiError({ message: `HTTP ${String(status)}`, status });
		}
		return new ApiError({ message: String(cause) });
	};

	const asVoid = <A>(effect: Effect.Effect<A, ApiError>): Effect.Effect<void, ApiError> =>
		effect.pipe(Effect.map(() => undefined));

	const envelopeData = (value: JsonValue): JsonValue => {
		if (isRecord(value) && "data" in value) return value.data;
		return value;
	};

	const decodeIdentity = (value: JsonValue): Effect.Effect<Identity, ApiError> =>
		Effect.try({
			try: () => {
				const obj = toRecord(envelopeData(value));
				const accounts = Array.isArray(obj?.accounts) ? obj.accounts : [];
				const firstAccount = toRecord(accounts[0]);
				const userCandidate = toRecord(obj?.user) || toRecord(firstAccount?.user) || obj;
				const userId = readString(userCandidate?.id) || readString(obj?.user_id);
				if (!userId) {
					throw new ApiError({ message: "Failed to decode identity: missing userId" });
				}
				return {
					userId,
					name: readString(userCandidate?.name),
					email: readString(userCandidate?.email),
				};
			},
			catch: (cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
		});

	const decodeCard = (value: JsonValue): Effect.Effect<Card, ApiError> =>
		Effect.try({
			try: () => {
				const obj = toRecord(value);
				if (!obj) {
					throw new ApiError({ message: "Failed to decode card: expected object" });
				}

				const number = readFiniteNumber(obj.number);
				if (!Number.isFinite(number)) {
					throw new ApiError({ message: "Failed to decode card: number must be finite" });
				}

				const title = readString(obj.title);
				if (!title) {
					throw new ApiError({ message: "Failed to decode card: title must be string" });
				}

				const descriptionHtml = readString(obj.description_html);
				const tags = decodeTags(obj.tags);
				return {
					id: readString(obj.id),
					number,
					title,
					description: readString(obj.description),
					...(descriptionHtml ? { descriptionHtml } : {}),
					...(tags.length > 0 ? { tags } : {}),
					column: decodeColumnRef(obj.column),
					assignees: decodeAssignees(obj.assignees),
					closed: readBoolean(obj.closed),
					golden: readBoolean(obj.golden),
					steps: decodeSteps(obj.steps),
				};
			},
			catch: (cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
		});

	const decodeCards = (value: JsonValue): Effect.Effect<ReadonlyArray<Card>, ApiError> => {
		if (!Array.isArray(value)) {
			return Effect.fail(new ApiError({ message: "Failed to decode cards: expected array" }));
		}

		return Effect.forEach(value, decodeCard);
	};

	const decodeBoardColumns = (
		value: JsonValue,
	): Effect.Effect<ReadonlyArray<BoardColumn>, ApiError> => {
		if (!Array.isArray(value)) {
			return Effect.fail(new ApiError({ message: "Failed to decode columns: expected array" }));
		}

		const result: BoardColumn[] = [];
		for (const item of value) {
			const obj = toRecord(item);
			if (!obj) continue;

			const id = readString(obj.id);
			const name = readString(obj.name);
			if (!id || !name) continue;

			result.push({ id, name });
		}

		return Effect.succeed(result);
	};

	const decodeBoard = (value: JsonValue): Effect.Effect<Board, ApiError> =>
		Effect.try({
			try: () => {
				const obj = toRecord(value);
				if (!obj) {
					throw new ApiError({ message: "Failed to decode board: expected object" });
				}

				const id = readString(obj.id);
				if (!id) {
					throw new ApiError({ message: "Failed to decode board: missing id" });
				}

				return {
					id,
					name: readString(obj.name) || "",
				};
			},
			catch: (cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
		});

	const decodeBoards = (value: JsonValue): Effect.Effect<ReadonlyArray<Board>, ApiError> => {
		if (!Array.isArray(value)) {
			return Effect.fail(new ApiError({ message: "Failed to decode boards: expected array" }));
		}

		return Effect.forEach(value, decodeBoard);
	};

	const decodeBoardColumn = (value: JsonValue): Effect.Effect<BoardColumn, ApiError> =>
		Effect.try({
			try: () => {
				const obj = toRecord(value);
				if (!obj) {
					throw new ApiError({ message: "Failed to decode column: expected object" });
				}

				const id = readString(obj.id);
				const name = readString(obj.name);
				if (!id || !name) {
					throw new ApiError({ message: "Failed to decode column: missing id or name" });
				}

				return { id, name };
			},
			catch: (cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
		});

	const decodeComments = (value: JsonValue): Effect.Effect<ReadonlyArray<Comment>, ApiError> => {
		if (!Array.isArray(value)) {
			return Effect.fail(new ApiError({ message: "Failed to decode comments: expected array" }));
		}

		return Effect.succeed(value.map((entry) => decodeComment(entry)));
	};

	const decodeComment = (value: JsonValue): Comment => {
		const obj = toRecord(value);
		if (!obj) return {};

		return {
			created_at: readString(obj.created_at),
			creator: decodeCommentCreator(obj.creator),
			body: decodeCommentBody(obj.body),
		};
	};

	const decodeCommentCreator = (value: JsonValue): Comment["creator"] => {
		const obj = toRecord(value);
		if (!obj) return undefined;
		const name = readString(obj.name);
		if (!name) return {};
		return { name };
	};

	const decodeCommentBody = (value: JsonValue): Comment["body"] => {
		const obj = toRecord(value);
		if (!obj) return undefined;
		const plainText = readString(obj.plain_text);
		if (!plainText) return {};
		return { plain_text: plainText };
	};

	const decodeColumnRef = (value: JsonValue): ColumnRef | undefined => {
		const obj = toRecord(value);
		if (!obj) return undefined;
		return {
			id: readString(obj.id),
			name: readString(obj.name),
		};
	};

	const decodeAssignees = (value: JsonValue): ReadonlyArray<Assignee> => {
		if (!Array.isArray(value)) return [];

		const result: Assignee[] = [];
		for (const item of value) {
			const obj = toRecord(item);
			if (!obj) continue;
			const id = readString(obj.id);
			if (!id) continue;
			const name = readString(obj.name);
			if (!name) continue;
			result.push({ id, name });
		}
		return result;
	};

	const decodeTags = (value: JsonValue): ReadonlyArray<string> => {
		if (!Array.isArray(value)) return [];

		const result: string[] = [];
		for (const item of value) {
			if (typeof item === "string") {
				result.push(item);
				continue;
			}
			const obj = toRecord(item);
			const title = readString(obj?.title) || readString(obj?.name);
			if (title) result.push(title);
		}
		return result;
	};

	const decodeSteps = (value: JsonValue): ReadonlyArray<Step> => {
		if (!Array.isArray(value)) return [];

		const result: Step[] = [];
		for (const item of value) {
			const obj = toRecord(item);
			if (!obj) continue;
			const content = readString(obj.content);
			if (!content) continue;
			const completed = readBoolean(obj.completed);
			if (completed === undefined) continue;
			result.push({
				id: readString(obj.id),
				content,
				completed,
			});
		}
		return result;
	};

	const isRecord = (value: JsonValue): value is JsonObject =>
		value !== null && typeof value === "object" && !Array.isArray(value);

	const toRecord = (value: JsonValue): JsonObject | undefined =>
		isRecord(value) ? value : undefined;

	const readString = (value: JsonValue): string | undefined =>
		typeof value === "string" ? value : undefined;

	const readBoolean = (value: JsonValue): boolean | undefined =>
		typeof value === "boolean" ? value : undefined;

	const readFiniteNumber = (value: JsonValue): number => {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		return Number.NaN;
	};

	const accountParams = { accountId: config.account };
	const boardParams = { accountId: config.account, boardId: config.board ?? "" };

	const listColumns = () =>
		runGenerated(FizzyEffect.listColumns(boardParams)).pipe(Effect.flatMap(decodeBoardColumns));

	const createColumn = (name: string): Effect.Effect<JsonValue, ApiError> =>
		runGenerated(FizzyEffect.createColumn(boardParams, { name }));

	return {
		identity: () => runGenerated(FizzyEffect.getMyIdentity()).pipe(Effect.flatMap(decodeIdentity)),
		listBoards: () =>
			runGenerated(FizzyEffect.listBoards(accountParams)).pipe(Effect.flatMap(decodeBoards)),
		listColumns: () => listColumns(),
		createColumn: (name) =>
			Effect.gen(function* () {
				const payload = yield* createColumn(name);

				const fromBody = yield* decodeBoardColumn(payload).pipe(
					Effect.catch(() => Effect.succeed(undefined)),
				);
				if (fromBody) {
					return fromBody;
				}

				const columns = yield* listColumns();
				const found = columns.find((column) => column.name === name);
				if (!found) {
					return yield* new ApiError({ message: `Failed to create column ${name}` });
				}

				return found;
			}),
		listCards: (options) => {
			const query: FizzyEffect.ListCardsQueryParams = {};
			if (config.board) {
				query["board_ids[]"] = [config.board];
			}
			if (options?.indexedBy) query.indexed_by = options.indexedBy;
			if (options?.all) query.all = true;
			return runGenerated(FizzyEffect.listCards(accountParams, query)).pipe(
				Effect.flatMap(decodeCards),
			);
		},
		showCard: (number) =>
			runGenerated(FizzyEffect.getCard({ ...accountParams, cardNumber: number })).pipe(
				Effect.flatMap(decodeCard),
			),
		listComments: (number) =>
			runGenerated(FizzyEffect.listComments({ ...accountParams, cardNumber: number })).pipe(
				Effect.flatMap(decodeComments),
			),
		createCard: (input) =>
			runGenerated(
				FizzyEffect.createCard(accountParams, {
					title: input.title,
					description: input.description,
					board_id: input.board,
					column_id: input.columnId,
				}),
			).pipe(Effect.flatMap(decodeCard)),
		updateCard: (number, input) =>
			asVoid(runGenerated(FizzyEffect.updateCard({ ...accountParams, cardNumber: number }, input))),
		updateCardDescription: (number, description) =>
			asVoid(
				runGenerated(
					FizzyEffect.updateCard({ ...accountParams, cardNumber: number }, { description }),
				),
			),
		assignCard: (number, userId) =>
			asVoid(
				runGenerated(
					FizzyEffect.assignCard({ ...accountParams, cardNumber: number }, { assignee_id: userId }),
				),
			),
		tagCard: (number, tag) =>
			asVoid(
				runGenerated(
					FizzyEffect.tagCard({ ...accountParams, cardNumber: number }, { tag_title: tag }),
				),
			),
		moveCard: (number, columnId) =>
			asVoid(
				runGenerated(
					FizzyEffect.triageCard({ ...accountParams, cardNumber: number }, { column_id: columnId }),
				),
			),
		triageCard: (number, columnId) =>
			asVoid(
				runGenerated(
					FizzyEffect.triageCard({ ...accountParams, cardNumber: number }, { column_id: columnId }),
				),
			),
		untriageCard: (number) =>
			asVoid(runGenerated(FizzyEffect.unTriageCard({ ...accountParams, cardNumber: number }))),
		comment: (number, body) =>
			asVoid(
				runGenerated(FizzyEffect.createComment({ ...accountParams, cardNumber: number }, { body })),
			),
		closeCard: (number) =>
			asVoid(runGenerated(FizzyEffect.closeCard({ ...accountParams, cardNumber: number }))),
		postponeCard: (number) =>
			asVoid(runGenerated(FizzyEffect.postponeCard({ ...accountParams, cardNumber: number }))),
		createStep: (number, content, completed) =>
			asVoid(
				runGenerated(
					FizzyEffect.createStep(
						{ ...accountParams, cardNumber: number },
						{
							content,
							completed: Boolean(completed),
						},
					),
				),
			),
		updateStep: (number, stepId, input) => {
			const body: JsonObject = {};
			if (input.completed !== undefined) body.completed = input.completed;
			if (input.content !== undefined) body.content = input.content;
			return asVoid(
				runGenerated(
					FizzyEffect.updateStep(
						{ ...accountParams, cardNumber: number, stepId },
						body as UpdateStepRequestContent,
					),
				),
			);
		},
		deleteStep: (number, stepId) =>
			asVoid(
				runGenerated(FizzyEffect.deleteStep({ ...accountParams, cardNumber: number, stepId })),
			),
	};
};
