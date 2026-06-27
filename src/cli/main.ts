import { Command } from "effect/unstable/cli";
import { VERSION } from "../_shared/version";
import { checkForUpdate } from "../_shared/auto-update";
import { setupCmd } from "./setup.command";
import { authCmd } from "./auth.command";
import { flowCmd } from "./flow.command";
import { ossCmd } from "./oss.command";
import { openapiCmd } from "./openapi.command";
import { updateCmd } from "./update.command";
import { plannerCmd } from "./planner.command";
import { skillCmd } from "./skill.command";
import { migrateCmd } from "./migrate.command";

const rootCmd = Command.make("fizzyx").pipe(
	Command.withDescription("Fizzyx CLI — Fizzy workflow and code generation tool"),
	Command.withSubcommands([
		setupCmd,
		authCmd,
		flowCmd,
		skillCmd,
		migrateCmd,
		ossCmd,
		openapiCmd,
		updateCmd,
		plannerCmd,
	]),
);

export const runCli = (args: ReadonlyArray<string>) => {
	checkForUpdate();
	return Command.runWith(rootCmd, { version: VERSION })(args);
};
