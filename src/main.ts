#!/usr/bin/env bun

import { Effect } from "effect";
import { runCli } from "./cli/main";
import { Live as ConfigRepoLive } from "./adapters/bun-config-repository";

const program = runCli(Bun.argv.slice(2)).pipe(Effect.provide(ConfigRepoLive));

Effect.runPromise(program as Effect.Effect<void>).then(
	() => process.exit(0),
	(error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exit(1);
	},
);
