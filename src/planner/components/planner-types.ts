import type { ReactNode } from "react";

export type PlannerLane = "todo" | "ready" | "in_progress" | "review" | "done" | "blocked";
export type PlannerView = "overview" | "roadmap" | "calendar" | "my" | "board" | "health";

export type PlannerUser = { id: string; name: string; avatarUrl?: string };

export type PlannerCard = {
	number: number;
	title: string;
	lane: PlannerLane;
	closed: boolean;
	postponed: boolean;
	tags: string[];
	createdAt: string;
	lastActiveAt: string;
	url: string;
	column?: { id: string; name: string };
	parsedTags: {
		priority: string[];
		type: string[];
		area: string[];
		phase: string[];
		apiStatus: string[];
		dependsOn: number[];
		blocks: number[];
	};
	metadata: {
		priority?: string;
		type?: string;
		owner?: string;
		deadline?: string;
		impact?: string;
		effort?: string;
		depends_on: number[];
		blocks: number[];
		phase?: string;
		api_status?: string;
	};
	body: string;
	assignees: PlannerUser[];
	steps: Array<{ id?: string; content: string; completed: boolean }>;
	comments: Array<{ id: string; createdAt: string; body: string; creator: PlannerUser }>;
	stepProgress: { completed: number; total: number };
};

export type PlannerIssue = {
	cardNumber: number;
	title: string;
	severity: "info" | "warning" | "critical";
	code: string;
	message: string;
};
export type PlannerRecommendation = {
	cardNumber: number;
	title: string;
	reason: string;
	score: number;
};

export type PlannerSnapshot = {
	generatedAt: string;
	cache?: "fresh" | "stale";
	account: string;
	board: string;
	boardName: string;
	identity?: PlannerUser;
	users: PlannerUser[];
	cards: PlannerCard[];
	summary: {
		total: number;
		lanes: Record<PlannerLane, number>;
		priorities: Record<"p0" | "p1" | "p2", number>;
		healthIssues: number;
	};
	health: PlannerIssue[];
	recommendations: PlannerRecommendation[];
};

export type SelectCard = (card: PlannerCard) => void;

export type ViewDefinition = {
	key: PlannerView;
	label: string;
	description: string;
	icon: ReactNode;
};
