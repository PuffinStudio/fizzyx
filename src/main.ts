#!/usr/bin/env bun

import { Effect } from "effect";
import { runCli } from "./cli/main";
import { Live as ConfigRepoLive } from "./adapters/bun-config-repository";

Effect.runPromise(runCli(Bun.argv.slice(2)).pipe(Effect.provide(ConfigRepoLive))).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exit(1);
});
