import { Effect } from "effect";
import { ConfigError, FileError } from "../domain/errors";
import type { ProjectConfig } from "../domain/models";
import { CONFIG_FILE, ConfigRepo, type ConfigRepository } from "../ports/config-repository";
import { makePlannerRuntime, type PlannerRuntimeApi } from "../adapters/planner-runtime";
import { DEFAULT_ACCOUNT, DEFAULT_API_URL } from "./flow-env";

export interface PlannerRuntimeContext {
	config: ProjectConfig;
	runtime: PlannerRuntimeApi;
}

export interface PlannerRuntimeOptions {
	readonly boardId?: string;
}

export const resolvePlannerServiceConfig = ({ boardId }: PlannerRuntimeOptions = {}): Effect.Effect<
	{ config: ProjectConfig },
	ConfigError | FileError,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const projectConfig = yield* configRepo.loadProjectConfigOptional();
		const baseConfig =
			projectConfig ||
			({
				apiUrl: DEFAULT_API_URL,
				account: DEFAULT_ACCOUNT,
				configPath: `${process.cwd()}/${CONFIG_FILE}`,
				rootDir: process.cwd(),
			} satisfies ProjectConfig);
		const config = {
			...baseConfig,
			...(boardId ? { board: boardId } : {}),
		} satisfies ProjectConfig;
		return { config };
	});

export const makePlannerServiceRuntime = (
	options: PlannerRuntimeOptions = {},
): Effect.Effect<PlannerRuntimeContext, ConfigError | FileError, ConfigRepository> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const { config } = yield* resolvePlannerServiceConfig(options);
		const credentials = yield* configRepo.loadCredentials(config.account);
		return { config, runtime: makePlannerRuntime(config, credentials) };
	});
