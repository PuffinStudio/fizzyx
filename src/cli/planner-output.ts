import type { PlannerRepairMetadataResult, PlannerSnapshot } from "../domain/planner-model";

export const formatPlannerSnapshotJson = (snapshot: PlannerSnapshot): string =>
	JSON.stringify(snapshot, null, 2);

export const formatPlannerHealthResult = (snapshot: Pick<PlannerSnapshot, "health">): string => {
	const lines: string[] = [];
	lines.push(`health issues: ${snapshot.health.length}`);
	for (const issue of snapshot.health.slice(0, 30)) {
		lines.push(`#${issue.cardNumber} [${issue.severity}] ${issue.message} — ${issue.title}`);
	}
	return lines.join("\n");
};

export const formatCheckingPlannerHealthMessage = (): string => "Checking planner health...";

export const formatRepairMetadataSummary = (result: PlannerRepairMetadataResult): string =>
	`${result.applied ? "applied" : "dry-run"}: ${result.changes.length} cards inspected`;

export const formatRepairMetadataChange = (
	cardNumber: number,
	action: string,
	reason: string,
	title: string,
): string => `#${cardNumber} ${action}: ${reason} — ${title}`;

export const formatRepairMetadataReminder = (): string =>
	"Run with --apply to write these description changes.";
