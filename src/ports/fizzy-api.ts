import { Context, type Effect } from "effect";
import type { ApiError } from "../domain/errors";
import type { Board, BoardColumn, Card, CardNumber, Comment, Identity } from "../domain/models";

export interface FizzyApi {
	identity: () => Effect.Effect<Identity, ApiError>;
	listBoards: () => Effect.Effect<ReadonlyArray<Board>, ApiError>;
	listCards: (options?: {
		indexedBy?: string;
		all?: boolean;
	}) => Effect.Effect<ReadonlyArray<Card>, ApiError>;
	showCard: (number: CardNumber) => Effect.Effect<Card, ApiError>;
	listComments: (number: CardNumber) => Effect.Effect<ReadonlyArray<Comment>, ApiError>;
	listColumns: () => Effect.Effect<ReadonlyArray<BoardColumn>, ApiError>;
	createColumn: (name: string) => Effect.Effect<BoardColumn, ApiError>;
	createCard: (input: {
		title: string;
		description: string;
		board: string;
	}) => Effect.Effect<Card, ApiError>;
	assignCard: (number: CardNumber, userId: string) => Effect.Effect<void, ApiError>;
	selfAssignCard: (number: CardNumber) => Effect.Effect<void, ApiError>;
	moveCard: (number: CardNumber, columnId: string) => Effect.Effect<void, ApiError>;
	comment: (number: CardNumber, body: string) => Effect.Effect<void, ApiError>;
	closeCard: (number: CardNumber) => Effect.Effect<void, ApiError>;
	postponeCard: (number: CardNumber) => Effect.Effect<void, ApiError>;
	updateCardDescription: (number: CardNumber, description: string) => Effect.Effect<void, ApiError>;
	updateStep: (
		number: CardNumber,
		stepId: string,
		input: {
			completed?: boolean;
			content?: string;
		},
	) => Effect.Effect<void, ApiError>;
	createStep: (
		number: CardNumber,
		content: string,
		completed?: boolean,
	) => Effect.Effect<void, ApiError>;
}

export const FizzyApi = Context.Service<FizzyApi>("FizzyApi");
