import { Effect } from "effect";
import { ConfigError, FileError } from "../domain/errors";
import type { ProjectConfig } from "../domain/models";
import { ConfigRepo, type ConfigRepository } from "../ports/config-repository";
import { makePlannerRuntime, type PlannerRuntimeApi } from "../adapters/planner-runtime";

export interface PlannerRuntimeContext {
	config: ProjectConfig;
	runtime: PlannerRuntimeApi;
}

export const makePlannerServiceRuntime = (): Effect.Effect<
	PlannerRuntimeContext,
	ConfigError | FileError,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		const credentials = yield* configRepo.loadCredentials(config.account);
		return { config, runtime: makePlannerRuntime(config, credentials) };
	});
