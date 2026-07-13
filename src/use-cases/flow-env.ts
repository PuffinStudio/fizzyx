import { Effect } from "effect";
import { AuthError, ValidationError } from "../domain/errors";
import type { InitializedProjectConfig, ProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import { makeBunCacheRepository } from "../adapters/bun-cache-repository";
import { makeFetchFizzyApi } from "../adapters/fetch-fizzy-api";
import {
	ensureFlowConfig,
	loadConfigOrDefaults as loadFlowConfigOrDefaults,
} from "./flow-bootstrap";
import { makeFlowApiWithAuthRetry } from "./flow-auth";

export interface Env {
	config: ProjectConfig;
	configRepo: ConfigRepository;
	cacheRepo: ReturnType<typeof makeBunCacheRepository>;
	api: ReturnType<typeof makeFetchFizzyApi>;
}

export interface InitializedEnv extends Env {
	config: InitializedProjectConfig;
}

export const DEFAULT_ACCOUNT = "1";
export const DEFAULT_API_URL = "https://fizzy.puffin.studio";

export const makeEnv = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* configRepo.loadProjectConfig();
	const board = yield* requireBoard(config);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(
		Effect.catch(() =>
			Effect.fail(
				new AuthError({
					message: `No token for account ${config.account}. Run: fizzyx auth login <token>`,
				}),
			),
		),
	);
	const cacheRepo = makeBunCacheRepository(config.account, board);
	const api = makeFetchFizzyApi(config, credentials.token);
	return { config, configRepo, cacheRepo, api } satisfies Env;
});

export const makeFlowRuntimeEnv = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* configRepo.loadProjectConfig();
	const board = yield* requireBoard(config);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(
		Effect.catch(() =>
			Effect.fail(
				new AuthError({
					message: `No token for account ${config.account}. Run: fizzyx auth login <token>`,
				}),
			),
		),
	);
	const cacheRepo = makeBunCacheRepository(config.account, board);
	const api = makeFlowApiWithAuthRetry({ configRepo, config, initialToken: credentials.token });

	return { config, configRepo, cacheRepo, api } satisfies Env;
});

export const makeFlowEnv = Effect.gen(function* () {
	const env = yield* makeFlowRuntimeEnv;
	const initializedConfig = yield* bootstrapFlowConfig(env, { repairWorkflowColumns: false });
	return { ...env, config: initializedConfig } satisfies InitializedEnv;
});

export const bootstrapFlowConfig = (
	env: Env,
	options: {
		repairWorkflowColumns?: boolean;
	} = {},
): Effect.Effect<InitializedProjectConfig, unknown> =>
	ensureFlowConfig({
		configRepo: env.configRepo,
		api: env.api,
		config: env.config,
		repairWorkflowColumns: options.repairWorkflowColumns,
	});

export const loadConfigOrDefaults = (configRepo: ConfigRepository) =>
	loadFlowConfigOrDefaults(configRepo);

const requireBoard = (config: ProjectConfig): Effect.Effect<string, ValidationError> =>
	config.board
		? Effect.succeed(config.board)
		: Effect.fail(
				new ValidationError({
					message: "No board configured. Run: fizzyx setup <board-id>",
				}),
			);
