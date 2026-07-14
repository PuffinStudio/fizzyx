import type { ReactNode } from "react";
import type {
	PlannerBoard as DomainPlannerBoard,
	PlannerCard as DomainPlannerCard,
	PlannerContext as DomainPlannerContext,
	PlannerHealthIssue,
	PlannerLane as DomainPlannerLane,
	PlannerRecommendation as DomainPlannerRecommendation,
	PlannerSnapshot as DomainPlannerSnapshot,
	PlannerUser as DomainPlannerUser,
} from "../../domain/planner-model";

export type PlannerLane = DomainPlannerLane;
export type PlannerUser = DomainPlannerUser;
export type PlannerCard = DomainPlannerCard;
export type PlannerIssue = PlannerHealthIssue;
export type PlannerRecommendation = DomainPlannerRecommendation;
export type PlannerSnapshot = DomainPlannerSnapshot;
export type PlannerBoard = DomainPlannerBoard;
export type PlannerContext = DomainPlannerContext;

export type PlannerView = "overview" | "roadmap" | "calendar" | "my" | "board" | "health";
export type SelectCard = (card: PlannerCard) => void;

export type ViewDefinition = {
	key: PlannerView;
	label: string;
	description: string;
	icon: ReactNode;
};
