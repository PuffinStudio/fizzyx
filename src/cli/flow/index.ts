import { Command } from "effect/unstable/cli";
import { flowAssignCmd } from "./assign";
import { flowBlockCmd } from "./block";
import { flowCreateCmd } from "./create";
import { flowColumnsCmd } from "./columns";
import { flowCommentCmd } from "./comment";
import { flowEditCmd } from "./edit";
import { flowDoneCmd } from "./done";
import { flowDoctorCmd } from "./doctor";
import { flowImproveCmd } from "./improve";
import { flowListCmd } from "./list";
import { flowMoveCmd } from "./move";
import { flowRepairCmd } from "./repair";
import { flowReopenCmd } from "./reopen";
import { flowReviewCmd } from "./review";
import { flowShowCmd } from "./show";
import { flowStartCmd } from "./start";
import { flowSearchCmd } from "./search";
import { flowUnblockCmd } from "./unblock";
import { flowUntriageCmd } from "./untriage";
import { flowWorkCmd } from "./work";

export const flowCmd = Command.make("flow").pipe(
	Command.withDescription("Manage Fizzy workflow boards"),
	Command.withSubcommands([
		flowWorkCmd,
		flowListCmd,
		flowSearchCmd,
		flowColumnsCmd,
		flowCreateCmd,
		flowEditCmd,
		flowAssignCmd,
		flowCommentCmd,
		flowShowCmd,
		flowMoveCmd,
		flowStartCmd,
		flowReviewCmd,
		flowDoneCmd,
		flowReopenCmd,
		flowBlockCmd,
		flowUnblockCmd,
		flowUntriageCmd,
		flowImproveCmd,
		flowRepairCmd,
		flowDoctorCmd,
	]),
);
