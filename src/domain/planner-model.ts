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
	action: "update_description" | "skip";
	reason: string;
	description?: string;
}

export interface PlannerUpdateDeadlineResult {
	cardNumber: number;
	deadline: string | null;
}

export interface PlannerSetDeadlineInput {
	cardNumber: number;
	deadline?: string;
}

export const REPAIRABLE_METADATA_ISSUE_CODES = new Set([
	"missing_priority",
	"invalid_priority",
	"missing_type",
	"missing_owner",
	"multiple_priority",
]);

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
}
