import { Effect } from "effect";
import type { ProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { makeAuthenticatedFetchFizzyApi } from "../adapters/fetch-fizzy-api";
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
}: FlowApiAuthPolicyContext): FizzyApi =>
	makeAuthenticatedFetchFizzyApi({ configRepo, config, initialToken });

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
