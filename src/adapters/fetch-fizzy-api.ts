import { Effect, Layer } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
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
type HttpMethod = "GET" | "POST" | "PATCH";
type JsonValue = unknown;

export const makeFetchFizzyApi = (config: ProjectConfig, token: string): FizzyApi => {
	const requestJson = (
		method: HttpMethod,
		path: string,
		body?: JsonValue,
	): Effect.Effect<JsonValue, ApiError> =>
		Effect.gen(function* () {
			const response = yield* executeRequest(method, path, body);
			const payload = yield* readPayload(response);

			if (response.status < 200 || response.status >= 300) {
				return yield* new ApiError({
					message: responseMessage(payload, response.status),
					status: response.status,
				});
			}

			return envelopeData(payload);
		}).pipe(
			Effect.catch((cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
			),
		);

	const requestVoid = (
		method: HttpMethod,
		path: string,
		body?: JsonValue,
	): Effect.Effect<void, ApiError> =>
		Effect.gen(function* () {
			const response = yield* executeRequest(method, path, body);
			if (response.status < 200 || response.status >= 300) {
				const payload = yield* readPayload(response);
				return yield* new ApiError({
					message: responseMessage(payload, response.status),
					status: response.status,
				});
			}
		}).pipe(
			Effect.catch((cause) =>
				cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
			),
		);

	const executeRequest = (
		method: HttpMethod,
		path: string,
		body?: JsonValue,
	): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError> =>
		body === undefined
			? doExecute(
					HttpClientRequest.make(method)(buildUrl(config, path), {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/json",
						},
					}),
				)
			: HttpClientRequest.bodyJson(body)(
					HttpClientRequest.make(method)(buildUrl(config, path), {
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/json",
						},
					}),
				).pipe(
					Effect.mapError((cause) => new ApiError({ message: String(cause) })),
					Effect.flatMap(doExecute),
					Effect.catch((cause) =>
						cause instanceof ApiError ? cause : new ApiError({ message: String(cause) }),
					),
				);

	const doExecute = (
		request: HttpClientRequest.HttpClientRequest,
	): Effect.Effect<HttpClientResponse.HttpClientResponse, ApiError> =>
		HttpClient.execute(request).pipe(
			Effect.provide(FetchHttpClient.layer),
			Effect.mapError((cause) => new ApiError({ message: String(cause) })),
		);

	const readPayload = (
		response: HttpClientResponse.HttpClientResponse,
	): Effect.Effect<JsonValue, ApiError> =>
		response.text.pipe(
			Effect.mapError((cause) => new ApiError({ message: String(cause) })),
			Effect.flatMap((text) => {
				if (!text) {
					return Effect.succeed(null);
				}

				return parseJson(text, response.status);
			}),
		);

	const buildUrl = (config: ProjectConfig, path: string): string => {
		const base = config.apiUrl.replace(/\/+$/, "");
		const cleanPath = path.startsWith("/") ? path : `/${path}`;
		const isMyPath = cleanPath.startsWith("/my/");
		const accountPrefix = `/${config.account}`;
		return `${base}${
			isMyPath || cleanPath.startsWith(`${accountPrefix}/`)
				? cleanPath
				: `${accountPrefix}${cleanPath}`
		}`;
	};

	const parseJson = (text: string, status: number): Effect.Effect<JsonValue, ApiError> =>
		Effect.try({
			try: () => JSON.parse(text),
			catch: () =>
				new ApiError({
					status,
					message: `HTTP ${String(status)}: invalid JSON response (${shortBodySnippet(text)})`,
				}),
		});

	const shortBodySnippet = (text: string, maxLength = 120): string => {
		const normalized = text.trim();
		return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
	};

	const envelopeData = (value: JsonValue): JsonValue => {
		if (isRecord(value) && "data" in value) return value.data;
		return value;
	};

	const responseMessage = (value: JsonValue, status: number): string => {
		if (isRecord(value) && "error" in value) {
			return String(value.error);
		}
		return `HTTP ${String(status)}`;
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
				return {
					id: readString(obj.id),
					number,
					title,
					description: readString(obj.description),
					...(descriptionHtml ? { descriptionHtml } : {}),
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

	const listColumns = () =>
		requestJson("GET", `/boards/${config.board}/columns.json`).pipe(
			Effect.flatMap(decodeBoardColumns),
		);
	const createColumn = (name: string): ReturnType<typeof requestJson> =>
		requestJson("POST", `/boards/${config.board}/columns.json`, { column: { name } });

	return {
		identity: () => requestJson("GET", "/my/identity.json").pipe(Effect.flatMap(decodeIdentity)),
		listBoards: () => requestJson("GET", "/boards.json").pipe(Effect.flatMap(decodeBoards)),
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
			const params = new URLSearchParams();
			if (config.board) {
				params.append("board_ids[]", config.board);
			}
			if (options?.indexedBy) params.set("indexed_by", options.indexedBy);
			if (options?.all) params.set("all", "true");
			const suffix = params.size > 0 ? `?${params}` : "";
			return requestJson("GET", `/cards.json${suffix}`).pipe(Effect.flatMap(decodeCards));
		},
		showCard: (number) =>
			requestJson("GET", `/cards/${number}.json`).pipe(Effect.flatMap(decodeCard)),
		listComments: (number) =>
			requestJson("GET", `/cards/${number}/comments.json?all=true`).pipe(
				Effect.flatMap(decodeComments),
			),
		createCard: (input) =>
			requestJson("POST", "/cards.json", {
				board_id: input.board,
				title: input.title,
				description: input.description,
			}).pipe(Effect.flatMap(decodeCard)),
		updateCardDescription: (number, description) =>
			requestVoid("PATCH", `/cards/${number}.json`, { description }),
		assignCard: (number, userId) =>
			requestVoid("POST", `/cards/${number}/assignments.json`, { assignee_id: userId }),
		selfAssignCard: (number) => requestVoid("POST", `/cards/${number}/self_assignment.json`),
		moveCard: (number, columnId) =>
			requestVoid("POST", `/cards/${number}/triage.json`, { column_id: columnId }),
		comment: (number, body) => requestVoid("POST", `/cards/${number}/comments.json`, { body }),
		closeCard: (number) => requestVoid("POST", `/cards/${number}/close.json`),
		postponeCard: (number) => requestVoid("POST", `/cards/${number}/postpone.json`),
		createStep: (number, content, completed) =>
			requestVoid("POST", `/cards/${number}/steps.json`, {
				content,
				completed: Boolean(completed),
			}),
		updateStep: (number, stepId, input) => {
			const body: JsonObject = {};
			if (input.completed !== undefined) body.completed = input.completed;
			if (input.content !== undefined) body.content = input.content;
			return requestVoid("PATCH", `/cards/${number}/steps/${stepId}.json`, body);
		},
	};
};
