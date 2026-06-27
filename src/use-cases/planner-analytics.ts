import type {
	PlannerCard,
	PlannerHealthIssue,
	PlannerLane,
	PlannerRecommendation,
	PlannerSnapshot,
} from "../domain/planner-model";
import type { PlannerPriority } from "./planner-metadata";
import { normalizePriority } from "./planner-transform";

const PLANNER_LANES: ReadonlyArray<PlannerLane> = [
	"todo",
	"ready",
	"in_progress",
	"review",
	"done",
	"blocked",
];

export const analyzePlannerHealth = (
	cards: ReadonlyArray<PlannerCard>,
	now: Date = new Date(),
): ReadonlyArray<PlannerHealthIssue> => {
	const issues: PlannerHealthIssue[] = [];
	const doneNumbers = new Set(
		cards.filter((card) => card.lane === "done").map((card) => card.number),
	);
	const byNumber = new Map(cards.map((card) => [card.number, card] as const));

	for (const card of cards) {
		const priority = getPriority(card);
		const type = getType(card);
		const owner = card.metadata.owner || card.assignees[0]?.name;
		const rawPriority = card.parsedTags.priority[0] || card.metadata.priority;
		if (!priority) {
			if (rawPriority) {
				addIssue(
					issues,
					card,
					"warning",
					"invalid_priority",
					`Priority "${rawPriority}" is not one of p0/p1/p2`,
				);
			} else {
				addIssue(issues, card, "warning", "missing_priority", "Missing priority tag/frontmatter");
			}
		}
		if (!type) addIssue(issues, card, "warning", "missing_type", "Missing type tag/frontmatter");
		if (!owner) addIssue(issues, card, "warning", "missing_owner", "Missing owner and assignee");
		if (card.parsedTags.priority.length > 1) {
			addIssue(issues, card, "warning", "multiple_priority", "Multiple priority tags");
		}
		if (priority === "p0" && card.lane === "todo") {
			addIssue(issues, card, "critical", "p0_in_todo", "P0 card is still in TODO without progress");
		}
		if (card.lane === "in_progress" && ageDays(card, now) > 3) {
			addIssue(issues, card, "warning", "stale_in_progress", "IN PROGRESS card is stale > 3 days");
		}
		if (card.lane === "review" && ageDays(card, now) > 2) {
			addIssue(issues, card, "warning", "stale_review", "REVIEW card is stale > 2 days");
		}
		for (const dependency of card.metadata.depends_on) {
			if (byNumber.has(dependency) && !doneNumbers.has(dependency)) {
				addIssue(
					issues,
					card,
					"warning",
					"dependency_not_done",
					`Depends on #${dependency}, which is not done`,
				);
			}
		}
	}

	return issues;
};

export const buildPlannerSummary = (
	cards: ReadonlyArray<PlannerCard>,
	health: ReadonlyArray<PlannerHealthIssue>,
): PlannerSnapshot["summary"] => {
	const lanes = Object.fromEntries(PLANNER_LANES.map((lane) => [lane, 0])) as Record<
		PlannerLane,
		number
	>;
	const priorities: Record<PlannerPriority, number> = { p0: 0, p1: 0, p2: 0 };
	for (const card of cards) {
		lanes[card.lane] += 1;
		const priority = getPriority(card);
		if (priority) priorities[priority] += 1;
	}
	return { total: cards.length, lanes, priorities, healthIssues: health.length };
};

export const buildPlannerRecommendations = (
	cards: ReadonlyArray<PlannerCard>,
	health: ReadonlyArray<PlannerHealthIssue>,
): ReadonlyArray<PlannerRecommendation> => {
	const criticalByCard = new Map<number, number>();
	for (const issue of health) {
		if (issue.severity === "critical") {
			criticalByCard.set(issue.cardNumber, (criticalByCard.get(issue.cardNumber) || 0) + 1);
		}
	}

	return cards
		.map((card) => {
			const priority = getPriority(card);
			let score = priority === "p0" ? 100 : priority === "p1" ? 60 : priority === "p2" ? 20 : 0;
			if (card.lane === "ready") score += 30;
			if (card.lane === "review") score += 25;
			if (card.lane === "blocked") score -= 40;
			score += (criticalByCard.get(card.number) || 0) * 25;
			return {
				cardNumber: card.number,
				title: card.title,
				reason: recommendationReason(card, priority),
				score,
			};
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 12);
};

const recommendationReason = (card: PlannerCard, priority: PlannerPriority | undefined): string => {
	const parts = [priority ? priority.toUpperCase() : undefined, card.lane.replace("_", " ")].filter(
		Boolean,
	);
	return parts.join(" · ");
};

const getPriority = (card: PlannerCard): PlannerPriority | undefined =>
	card.parsedTags.priority[0] || normalizePriority(card.metadata.priority);

const getType = (card: PlannerCard): string | undefined =>
	card.parsedTags.type[0] || card.metadata.type;

const addIssue = (
	issues: PlannerHealthIssue[],
	card: PlannerCard,
	severity: PlannerHealthIssue["severity"],
	code: string,
	message: string,
): void => {
	issues.push({ cardNumber: card.number, title: card.title, severity, code, message });
};

const ageDays = (card: PlannerCard, now: Date): number => {
	const raw = card.lastActiveAt || card.createdAt;
	if (!raw) return 0;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return 0;
	return (now.getTime() - date.getTime()) / 86_400_000;
};
