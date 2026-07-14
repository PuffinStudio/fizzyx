import type {
	ParsedPlannerTags,
	PlannerMetadata,
	PlannerPriority,
} from "../use-cases/planner-metadata";

export type PlannerLane = "todo" | "ready" | "in_progress" | "review" | "done" | "blocked";

export interface PlannerCard {
	number: number;
	title: string;
	lane: PlannerLane;
	column?: { id: string; name: string };
	closed: boolean;
	postponed: boolean;
	tags: ReadonlyArray<string>;
	parsedTags: ParsedPlannerTags;
	metadata: PlannerMetadata;
	metadataWarnings: ReadonlyArray<string>;
	body: string;
	assignees: ReadonlyArray<PlannerUser>;
	createdAt?: string;
	lastActiveAt?: string;
	steps: ReadonlyArray<{ id?: string; content: string; completed: boolean }>;
	comments: ReadonlyArray<PlannerComment>;
	stepProgress: { completed: number; total: number };
	url?: string;
}

export interface PlannerComment {
	id: string;
	createdAt: string;
	body: string;
	creator: PlannerUser;
}

export interface PlannerHealthIssue {
	cardNumber: number;
	title: string;
	severity: "info" | "warning" | "critical";
	code: string;
	message: string;
}

export interface PlannerRecommendation {
	cardNumber: number;
	title: string;
	reason: string;
	score: number;
}

export interface PlannerBoard {
	id: string;
	name: string;
}

export interface PlannerContext {
	account: string;
	defaultBoard?: string;
	boards: ReadonlyArray<PlannerBoard>;
}

export interface PlannerSnapshot {
	generatedAt: string;
	cache?: "fresh" | "stale";
	account: string;
	board: string;
	boardName: string;
	identity?: PlannerUser;
	users: ReadonlyArray<PlannerUser>;
	columns: ReadonlyArray<{ id: string; name: string }>;
	tags: ReadonlyArray<{ id: string; title: string }>;
	cards: ReadonlyArray<PlannerCard>;
	summary: {
		total: number;
		lanes: Record<PlannerLane, number>;
		priorities: Record<PlannerPriority, number>;
		healthIssues: number;
	};
	health: ReadonlyArray<PlannerHealthIssue>;
	recommendations: ReadonlyArray<PlannerRecommendation>;
}

export interface PlannerUser {
	id: string;
	name: string;
	avatarUrl?: string;
}

export interface PlannerRepairMetadataOptions {
	apply: boolean;
	defaultPriority?: PlannerPriority;
	defaultType?: string;
}

export interface PlannerRepairMetadataChange {
	cardNumber: number;
	title: string;
	action: "tag_card" | "skip";
	reason: string;
	tags?: ReadonlyArray<string>;
}

export interface PlannerUpdateDeadlineResult {
	cardNumber: number;
	deadline: string | null;
}

export interface PlannerSetDeadlineInput {
	cardNumber: number;
	deadline?: string;
	boardId?: string;
}

export const REPAIRABLE_METADATA_ISSUE_CODES = new Set(["missing_priority", "missing_type"]);

export const isRepairableMetadataIssue = (issue: PlannerHealthIssue): boolean =>
	REPAIRABLE_METADATA_ISSUE_CODES.has(issue.code);

export interface PlannerRepairMetadataResult {
	applied: boolean;
	changes: ReadonlyArray<PlannerRepairMetadataChange>;
}

export interface PlannerSnapshotRouteDecision {
	snapshot: PlannerSnapshot;
	triggerBackgroundRefresh: boolean;
}

export interface PlannerSnapshotRequest {
	fresh: boolean;
	boardId?: string;
}

const PLANNER_LANES: ReadonlySet<string> = new Set<PlannerLane>([
	"todo",
	"ready",
	"in_progress",
	"review",
	"done",
	"blocked",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (record: Record<string, unknown>, key: string): void => {
	if (typeof record[key] !== "string")
		throw new TypeError(`Planner snapshot.${key} must be a string`);
};

const requireArray = (record: Record<string, unknown>, key: string): ReadonlyArray<unknown> => {
	const value = record[key];
	if (!Array.isArray(value)) throw new TypeError(`Planner snapshot.${key} must be an array`);
	return value;
};

export const decodePlannerSnapshot = (value: unknown): PlannerSnapshot => {
	if (!isRecord(value)) throw new TypeError("Planner snapshot must be an object");
	for (const key of ["generatedAt", "account", "board", "boardName"]) requireString(value, key);
	if (value.cache !== undefined && value.cache !== "fresh" && value.cache !== "stale") {
		throw new TypeError("Planner snapshot.cache must be fresh or stale");
	}
	for (const key of ["users", "columns", "tags", "health", "recommendations"]) {
		requireArray(value, key);
	}
	const cards = requireArray(value, "cards");
	for (const [index, card] of cards.entries()) {
		if (!isRecord(card)) throw new TypeError(`Planner snapshot.cards[${index}] must be an object`);
		if (typeof card.number !== "number" || typeof card.title !== "string") {
			throw new TypeError(`Planner snapshot.cards[${index}] requires number and title`);
		}
		if (typeof card.lane !== "string" || !PLANNER_LANES.has(card.lane)) {
			throw new TypeError(`Planner snapshot.cards[${index}].lane is invalid`);
		}
		for (const key of ["tags", "assignees", "steps", "comments", "metadataWarnings"]) {
			if (!Array.isArray(card[key])) {
				throw new TypeError(`Planner snapshot.cards[${index}].${key} must be an array`);
			}
		}
	}
	if (
		!isRecord(value.summary) ||
		!isRecord(value.summary.lanes) ||
		!isRecord(value.summary.priorities)
	) {
		throw new TypeError("Planner snapshot.summary is invalid");
	}
	return value as unknown as PlannerSnapshot;
};
