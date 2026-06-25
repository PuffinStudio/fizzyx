import type { DoctorResult } from "../use-cases/flow-service";

export const formatDoctorResult = (
	result: DoctorResult,
	options?: { applied?: boolean },
): string => {
	const applied = options?.applied === true;
	const lines: string[] = [];
	lines.push("=== Board Health ===");
	lines.push(`account: ${result.account}`);
	lines.push(`board: ${result.boardId}`);
	lines.push(`api: ${result.apiUrl}`);
	lines.push("");
	lines.push("API-visible columns:");
	for (const col of result.allColumns) {
		const isExpected = result.columns.some((c) => c.id === col.id);
		const status = isExpected ? "\u2713" : "\u2022";
		lines.push(`  ${status} ${col.name} (${col.id})`);
	}
	lines.push("");
	lines.push("Implicit system actions:");
	for (const action of result.systemActions) {
		lines.push(`  \u2713 ${action.name} via ${action.via} (not listed by columns API)`);
	}
	if (result.info.length > 0) {
		lines.push("");
		for (const msg of result.info) {
			lines.push(`  i ${msg}`);
		}
	}
	if (result.fixes.length > 0) {
		lines.push(`\n${applied ? "Applied fixes" : "Planned fixes"}:`);
		for (const fix of result.fixes) {
			lines.push(`  \u2022 ${fix}`);
		}

		if (!applied) {
			lines.push("\nRun `fizzyx flow doctor --apply` to apply these fixes.");
		}
	} else {
		lines.push("\nAll good!");
	}

	return lines.join("\n");
};

export const formatSyncResult = (cardCount: number, notNowCount: number): string =>
	`synced cards=${cardCount} not_now=${notNowCount}`;

export interface StandardizeSummaryInput {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}

export const formatStandardizeResult = (result: StandardizeSummaryInput): string =>
	`standardized #${result.number} description=${result.descriptionUpdated ? "yes" : "no"} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

export const formatMineHeader = (name: string, userId: string): string => `# ${name}: ${userId}`;

export const formatFlowStatusHeader = (age: number): string => `# board cache age: ${age}s`;

export const formatNotNowHeader = (count: number): string => `# not_now (${count})`;

export const formatNoTodoCard = (name: string): string => `no TODO card for ${name}`;

export const formatNotNowSection = (count: number): string => `\n# not_now (${count})`;

export const formatNextSummary = (number: number, title: string): string => `#${number} ${title}`;

export const formatNextAutoStartSummary = (number: number): string =>
	`started #${number} and now moving to execution`;

export const formatNextActionHint = (number: number): string =>
	`quick action: fizzyx flow start ${number}`;

export const formatCompleteStepsSummary = (updatedCount: number, number: number): string => {
	const plural = updatedCount === 1 ? "" : "s";
	return `completed ${updatedCount} step${plural} for #${number}`;
};

export interface StandardizeBoardSummary {
	total: number;
	descriptionUpdated: number;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}

export const formatStandardizeBoardSummary = (result: StandardizeBoardSummary): string =>
	`total=${result.total} descriptions=${result.descriptionUpdated} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

export const formatWorkflowTemplate = (content: string): string => content;

export const formatSkillTemplate = (content: string): string => content;

export const formatCommentTemplate = (template: string): string => template;

export const formatFlowTemplateDraftPath = (path: string): string => path;

export const formatFlowTemplateContent = (content: string): string => content;

export const formatStandardizeBoardResults = (
	results: ReadonlyArray<StandardizeSummaryInput>,
): string => results.map(formatStandardizeResult).join("\n");

export const formatBlankLine = (): string => "";

export const formatFlowConfigured = (todoColumnId: string, inProgressColumnId: string): string =>
	`flow configured: todo=${todoColumnId} in_progress=${inProgressColumnId}`;

export const formatFlowConfigMissing = (): string => "flow config missing; initializing...";

export const formatAddUsage = (): string => "usage: fizzyx flow add <user> <title> --desc <file|->";

export const formatRepairedCard = (number: number): string => `repaired #${number}`;

export const formatBlockedCard = (number: number, reason: string): string =>
	`blocked #${number}: ${reason}`;

export const formatStartedCard = (number: number): string => `started #${number}`;

export const formatMovedCard = (number: number, column: string): string =>
	`moved #${number} to ${column}`;

export const formatClosedCard = (number: number, ref: string): string =>
	`closed #${number} (${ref})`;

export const formatAssignedCard = (number: number, users: string): string =>
	`assigned #${number} to ${users}`;

export const formatCompletedSteps = (contents: ReadonlyArray<string>): string =>
	contents.map((content) => `- ${content}`).join("\n");

export const formatAddedCard = (number: number): string => `${number}`;

export const formatSyncingFizzyBoardMessage = (): string => "Syncing Fizzy board...";

export const formatLoadingMyTasksMessage = (): string => "Loading my tasks...";

export const formatLoadingBoardStatusMessage = (): string => "Loading board status...";

export const formatLoadingNextTaskMessage = (): string => "Loading next task...";

export const formatLoadingCardDetailsMessage = (): string => "Loading card details...";

export const formatStartingCardMessage = (): string => "Starting card...";

export const formatMovingCardToReadyMessage = (): string => "Moving card to READY...";

export const formatMovingCardToReviewMessage = (): string => "Moving card to REVIEW...";

export const formatClosingCardMessage = (): string => "Closing card...";

export const formatBlockingCardMessage = (): string => "Marking card blocked...";

export const formatAssigningCardMessage = (): string => "Assigning card...";

export const formatReadingWorkflowTemplateMessage = (): string =>
	"Reading local workflow template...";

export const formatWritingSkillScaffoldMessage = (): string => "Writing flow skill scaffold...";

export const formatReadingSkillFileMessage = (): string => "Reading local skill file...";

export const formatRepairingDescriptionMessage = (): string => "Repairing card description...";

export const formatCompletingStepsMessage = (): string => "Completing pending steps...";

export const formatStandardizingCardMessage = (): string => "Standardizing card...";

export const formatStandardizingBoardMessage = (): string => "Standardizing board...";

export const formatCreatingCardMessage = (): string => "Creating card...";

export const formatSyncingDoneWhenStepsMessage = (): string => "Syncing Done When steps...";

export const formatWritingCardDraftMessage = (): string => "Writing card draft...";

export const formatReadingCardTemplateMessage = (): string => "Reading local card template...";

export const formatCheckingFlowHealthMessage = (): string => "Checking flow health...";

export const formatInitializingWorkflowConfigMessage = (): string =>
	"Initializing workflow config...";
