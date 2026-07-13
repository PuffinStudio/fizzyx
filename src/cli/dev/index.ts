import { Command } from "effect/unstable/cli";
import { devStatusCmd } from "./status";
import { devStartCmd } from "./start";
import { devSyncCmd } from "./sync";
import { devCheckpointCmd } from "./checkpoint";
import { devReadyCmd } from "./ready";
import { devPromoteCmd } from "./promote";
import { devCleanupCmd } from "./cleanup";
import { devDoctorCmd } from "./doctor";
import { devBaselineCmd } from "./baseline";

export const devCmd = Command.make("dev").pipe(
	Command.withDescription("Git workflow commands for daily development"),
	Command.withSubcommands([
		devStatusCmd,
		devStartCmd,
		devSyncCmd,
		devCheckpointCmd,
		devReadyCmd,
		devPromoteCmd,
		devCleanupCmd,
		devDoctorCmd,
		devBaselineCmd,
	]),
);
