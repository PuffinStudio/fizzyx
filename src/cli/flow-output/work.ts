export const formatMineHeader = (name: string, userId: string): string => `# ${name}: ${userId}`;

export const formatFlowStatusHeader = (age: number): string => `# board cache age: ${age}s`;

export const formatNotNowHeader = (count: number): string => `# not_now (${count})`;

export const formatNoTodoCard = (name: string): string => `no TODO card for ${name}`;

export const formatWorkHeader = (name: string, userId: string): string =>
	`# work: ${name} (${userId})`;

export const formatWorkBoardSummary = (
	age: number,
	cardCount: number,
	notNowCount: number,
): string => `board age=${age}s cards=${cardCount} not_now=${notNowCount}`;

export const formatWorkSection = (title: string): string => `\n## ${title}`;

export const formatNoCurrentWork = (): string => "no active cards assigned in workflow columns";

export const formatImproveGuidance = (): string =>
	[
		"flow improve is deprecated; it does not inspect the codebase.",
		"Run `fizzyx skill run improve-codebase` and use `fizzyx flow create --draft` for actionable work.",
	].join("\n");

export const formatNotNowSection = (count: number): string => `\n# not_now (${count})`;

export const formatNextSummary = (number: number, title: string): string => `#${number} ${title}`;

export const formatNextAutoStartSummary = (number: number): string =>
	`started #${number} and now moving to execution`;

export const formatNextActionHint = (number: number): string =>
	["git guardrail: fizzyx dev status --agent", `quick action: fizzyx flow start ${number}`].join(
		"\n",
	);

export const formatCompleteStepsSummary = (updatedCount: number, number: number): string => {
	const plural = updatedCount === 1 ? "" : "s";
	return `completed ${updatedCount} step${plural} for #${number}`;
};

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
