#!/usr/bin/env bun

import { Effect } from "effect";
import { runCli } from "./cli/main";

Effect.runPromise(runCli(Bun.argv.slice(2))).catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exit(1);
});
