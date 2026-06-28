export interface StandardizeSummaryInput {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}

export const formatStandardizeResult = (result: StandardizeSummaryInput): string =>
	`standardized #${result.number} description=${result.descriptionUpdated ? "yes" : "no"} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

export const formatSyncResult = (cardCount: number, notNowCount: number): string =>
	`synced cards=${cardCount} not_now=${notNowCount}`;

export interface StandardizeBoardSummary {
	total: number;
	descriptionUpdated: number;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}

export const formatStandardizeBoardSummary = (result: StandardizeBoardSummary): string =>
	`total=${result.total} descriptions=${result.descriptionUpdated} steps_created=${result.stepsCreated} steps_updated=${result.stepsUpdated} steps_completed=${result.stepsCompleted}`;

export const formatStandardizeBoardResults = (
	results: ReadonlyArray<StandardizeSummaryInput>,
): string => results.map(formatStandardizeResult).join("\n");
