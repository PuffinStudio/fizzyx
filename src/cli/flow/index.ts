import { Command } from "effect/unstable/cli";
import { flowAssignCmd } from "./assign";
import { flowBlockCmd } from "./block";
import { flowCreateCmd } from "./create";
import { flowColumnsCmd } from "./columns";
import { flowEditCmd } from "./edit";
import { flowDoneCmd } from "./done";
import { flowDoctorCmd } from "./doctor";
import { flowImproveCmd } from "./improve";
import { flowMoveCmd } from "./move";
import { flowRepairCmd } from "./repair";
import { flowReviewCmd } from "./review";
import { flowShowCmd } from "./show";
import { flowStartCmd } from "./start";
import { flowWorkCmd } from "./work";

export const flowCmd = Command.make("flow").pipe(
	Command.withDescription("Manage Fizzy workflow boards"),
	Command.withSubcommands([
		flowWorkCmd,
		flowColumnsCmd,
		flowCreateCmd,
		flowEditCmd,
		flowAssignCmd,
		flowShowCmd,
		flowMoveCmd,
		flowStartCmd,
		flowReviewCmd,
		flowDoneCmd,
		flowBlockCmd,
		flowImproveCmd,
		flowRepairCmd,
		flowDoctorCmd,
	]),
);
