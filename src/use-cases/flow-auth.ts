import { Effect } from "effect";
import { ApiError, FileError } from "../domain/errors";
import type { ProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { makeFetchFizzyApi } from "../adapters/fetch-fizzy-api";
import { loadConfigOrDefaults } from "./flow-bootstrap";

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
		tagCard: (number, tag) => withAuthRetry((api) => api.tagCard(number, tag)),
		moveCard: (number, columnId) => withAuthRetry((api) => api.moveCard(number, columnId)),
		triageCard: (number, columnId) => withAuthRetry((api) => api.triageCard(number, columnId)),
		untriageCard: (number) => withAuthRetry((api) => api.untriageCard(number)),
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

export const authLogin = (token: string) =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* loadConfigOrDefaults(configRepo);
		yield* configRepo.saveCredentials(config.account, { token });
		return config.account;
	});

export const authStatus = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* loadConfigOrDefaults(configRepo);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(Effect.option);
	if (credentials._tag === "None") {
		return {
			account: config.account,
			board: config.board,
			authenticated: false,
		};
	}

	const api = makeFlowApiWithAuthRetry({
		configRepo,
		config,
		initialToken: credentials.value.token,
	});
	const identityResult = yield* api.identity().pipe(
		Effect.map((identity) => ({ _tag: "success", identity }) as const),
		Effect.catch((cause) =>
			Effect.succeed({
				_tag: "failure",
				error: cause instanceof Error ? cause.message : String(cause),
			} as const),
		),
	);

	return {
		account: config.account,
		board: config.board,
		authenticated: true,
		identity: identityResult._tag === "success" ? identityResult.identity : undefined,
		identityError: identityResult._tag === "failure" ? identityResult.error : undefined,
	};
});

export const authLogout = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* loadConfigOrDefaults(configRepo);
	yield* configRepo.deleteCredentials(config.account);
	return config.account;
});
