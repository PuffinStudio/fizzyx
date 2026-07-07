import * as HttpClient from "effect/unstable/http/HttpClient";
import { Effect } from "effect";
import type { ProjectConfig, Credentials } from "../domain/models";
import type {
	Board,
	Card,
	Column,
	GetMyIdentityResponseContent,
	ListCommentsResponseContent,
	Tag,
	User,
} from "../fizzy-effect/types";
import * as Fizzy from "../fizzy-effect/effect-client";
import type { EffectHttpClientError } from "../fizzy-effect/effect-client";

export interface PlannerRuntimeApi {
	config: {
		apiUrl: string;
		account: string;
		board?: string;
	};
	getMyIdentity: () => Effect.Effect<GetMyIdentityResponseContent, Error>;
	listBoards: (accountId: string) => Effect.Effect<ReadonlyArray<Board>, Error>;
	getBoard: (accountId: string, boardId: string) => Effect.Effect<Board, Error>;
	listUsers: (accountId: string) => Effect.Effect<ReadonlyArray<User>, Error>;
	listColumns: (accountId: string, boardId: string) => Effect.Effect<ReadonlyArray<Column>, Error>;
	listPostponedCards: (
		accountId: string,
		boardId: string,
	) => Effect.Effect<ReadonlyArray<Card>, Error>;
	listClosedCards: (
		accountId: string,
		boardId: string,
	) => Effect.Effect<ReadonlyArray<Card>, Error>;
	listTags: (accountId: string) => Effect.Effect<ReadonlyArray<Tag>, Error>;
	listColumnCards: (
		accountId: string,
		boardId: string,
		columnId: string,
	) => Effect.Effect<ReadonlyArray<Card>, Error>;
	listStreamCards: (
		accountId: string,
		boardId: string,
	) => Effect.Effect<ReadonlyArray<Card>, Error>;
	listCards: (
		accountId: string,
		options: Record<string, unknown>,
	) => Effect.Effect<ReadonlyArray<Card>, Error>;
	getCard: (accountId: string, cardNumber: number) => Effect.Effect<Card, Error>;
	listComments: (
		accountId: string,
		cardNumber: number,
	) => Effect.Effect<ReadonlyArray<ListCommentsResponseContent>, Error>;
	updateCard: (
		accountId: string,
		cardNumber: number,
		description: string,
	) => Effect.Effect<void, Error>;
	tagCard: (accountId: string, cardNumber: number, tag: string) => Effect.Effect<void, Error>;
}

export const makePlannerRuntime = (
	config: ProjectConfig,
	credentials: Credentials,
): PlannerRuntimeApi => {
	configureGeneratedClient(config.apiUrl, credentials.token);

	return {
		config: {
			apiUrl: config.apiUrl,
			account: config.account,
			board: config.board,
		},
		getMyIdentity: () => runSingle(Fizzy.getMyIdentity()),
		listBoards: (accountId) => runArray(Fizzy.listBoards({ accountId })),
		getBoard: (accountId, boardId) => runSingle(Fizzy.getBoard({ accountId, boardId })),
		listUsers: (accountId) => runArray(Fizzy.listUsers({ accountId })),
		listColumns: (accountId, boardId) => runArray(Fizzy.listColumns({ accountId, boardId })),
		listPostponedCards: (accountId, boardId) =>
			runArray(Fizzy.listPostponedCards({ accountId, boardId })),
		listClosedCards: (accountId, boardId) =>
			runArray(Fizzy.listClosedCards({ accountId, boardId })),
		listTags: (accountId) => runArray(Fizzy.listTags({ accountId })),
		listColumnCards: (accountId, boardId, columnId) =>
			runArray(Fizzy.listColumnCards({ accountId, boardId, columnId })),
		listStreamCards: (accountId, boardId) =>
			runArray(Fizzy.listStreamCards({ accountId, boardId })),
		listCards: (accountId, options) => runArray(Fizzy.listCards({ accountId }, options)),
		getCard: (accountId, cardNumber) => runSingle(Fizzy.getCard({ accountId, cardNumber })),
		listComments: (accountId, cardNumber) =>
			runArray(Fizzy.listComments({ accountId, cardNumber })),
		updateCard: (accountId, cardNumber, description) =>
			runSingle(Fizzy.updateCard({ accountId, cardNumber }, { description })).pipe(
				Effect.map(() => undefined),
			),
		tagCard: (accountId, cardNumber, tag) =>
			runSingle(Fizzy.tagCard({ accountId, cardNumber }, { tag_title: tag })).pipe(
				Effect.map(() => undefined),
			),
	};
};

const runArray = <A>(
	effect: Effect.Effect<unknown, EffectHttpClientError, HttpClient.HttpClient>,
): Effect.Effect<ReadonlyArray<A>, Error> =>
	effect.pipe(
		Effect.provide(Fizzy.FetchLayer),
		Effect.map((value) => (Array.isArray(value) ? (value as ReadonlyArray<A>) : [])),
		Effect.mapError((cause) => new Error(String(cause))),
	);

const runSingle = <A>(
	effect: Effect.Effect<A, EffectHttpClientError, HttpClient.HttpClient>,
): Effect.Effect<A, Error> =>
	effect.pipe(
		Effect.provide(Fizzy.FetchLayer),
		Effect.mapError((cause) => new Error(String(cause))),
	);

const configureGeneratedClient = (apiUrl: string, token: string): void => {
	Fizzy.configure({
		baseUrl: apiUrl.replace(/\/+$/, ""),
		responseExtractor: (value) => {
			if (value && typeof value === "object" && "data" in value) {
				return (value as { data: unknown }).data;
			}
			return value;
		},
	});
	Fizzy.setToken(token);
};
