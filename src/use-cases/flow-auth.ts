import { Effect } from "effect";
import { ApiError, FileError } from "../domain/errors";
import type { ProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { makeFetchFizzyApi } from "../adapters/fetch-fizzy-api";

export interface FlowApiAuthPolicyContext {
	configRepo: ConfigRepository;
	config: ProjectConfig;
	initialToken: string;
}

export const makeFlowApiWithAuthRetry = ({
	configRepo,
	config,
	initialToken,
}: FlowApiAuthPolicyContext): FizzyApi => {
	let token = initialToken;
	let api = makeFetchFizzyApi(config, token);

	const toApiError = (cause: unknown): ApiError =>
		cause instanceof ApiError ? cause : new ApiError({ message: String(cause) });

	const withAuthRetry = <T>(
		action: (api: FizzyApi) => Effect.Effect<T, ApiError>,
	): Effect.Effect<T, ApiError> =>
		Effect.gen(function* () {
			const first = yield* action(api).pipe(
				Effect.map((right) => ({ _tag: "right", right }) as const),
				Effect.catch((failure) =>
					Effect.succeed({ _tag: "left", left: toApiError(failure) } as const),
				),
			);

			if (first._tag === "right") {
				return first.right;
			}

			const failure = first.left;
			if (!isUnauthorizedApiError(failure)) {
				return yield* Effect.fail(failure);
			}

			const migrated = yield* configRepo
				.migrateCredentialsFromOfficial(config.account)
				.pipe(Effect.catch(() => Effect.fail(failure)));

			if (migrated.token !== token) {
				token = migrated.token;
				api = makeFetchFizzyApi(config, token);
				yield* configRepo.saveCredentials(config.account, migrated).pipe(
					Effect.catch(
						(cause) =>
							new ApiError({
								message: `Failed to persist migrated credentials: ${
									cause instanceof FileError ? cause.message : String(cause)
								}`,
							}),
					),
				);
			}

			return yield* action(api);
		});

	return {
		identity: () => withAuthRetry((api) => api.identity()),
		listBoards: () => withAuthRetry((api) => api.listBoards()),
		listCards: (options) => withAuthRetry((api) => api.listCards(options)),
		showCard: (number) => withAuthRetry((api) => api.showCard(number)),
		listComments: (number) => withAuthRetry((api) => api.listComments(number)),
		listColumns: () => withAuthRetry((api) => api.listColumns()),
		createColumn: (name) => withAuthRetry((api) => api.createColumn(name)),
		createCard: (input) => withAuthRetry((api) => api.createCard(input)),
		updateCardDescription: (number, description) =>
			withAuthRetry((api) => api.updateCardDescription(number, description)),
		assignCard: (number, userId) => withAuthRetry((api) => api.assignCard(number, userId)),
		moveCard: (number, columnId) => withAuthRetry((api) => api.moveCard(number, columnId)),
		comment: (number, body) => withAuthRetry((api) => api.comment(number, body)),
		closeCard: (number) => withAuthRetry((api) => api.closeCard(number)),
		postponeCard: (number) => withAuthRetry((api) => api.postponeCard(number)),
		updateStep: (number, stepId, input) =>
			withAuthRetry((api) => api.updateStep(number, stepId, input)),
		createStep: (number, content, completed) =>
			withAuthRetry((api) => api.createStep(number, content, completed)),
	} satisfies FizzyApi;
};

const isUnauthorizedApiError = (error: ApiError): boolean => error.status === 401;
