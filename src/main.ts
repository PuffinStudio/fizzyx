#!/usr/bin/env bun

import { Effect } from "effect";
import { runCli } from "./cli/main";
import { Live as ConfigRepoLive } from "./adapters/bun-config-repository";
import { GeneratorRegistryLive } from "./adapters/bun-generator-registry";
import { BunCredentialStoreLive } from "./adapters/bun-credential-store";
import { AdminProcessRunnerLive } from "./adapters/bun-admin-process-runner";

const program = runCli(Bun.argv.slice(2)).pipe(
	Effect.provide(ConfigRepoLive),
	Effect.provide(BunCredentialStoreLive),
	Effect.provide(GeneratorRegistryLive),
	Effect.provide(AdminProcessRunnerLive),
);

Effect.runPromise(program as Effect.Effect<void>).then(
	() => process.exit(0),
	(error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	},
);
