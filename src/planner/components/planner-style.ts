import type { PlannerIssue, PlannerLane } from "./planner-types";

export const priorityBadgeClass = (priority: string): string =>
	priority === "p0"
		? "bg-red-600 text-white"
		: priority === "p1"
			? "bg-amber-500 text-black"
			: "bg-sky-500 text-white";
export const laneBarClass = (title: string): string =>
	title === "Todo"
		? "bg-blue-500"
		: title === "Ready"
			? "bg-emerald-500"
			: title === "In Progress"
				? "bg-sky-500"
				: title === "Review"
					? "bg-violet-500"
					: title === "Done"
						? "bg-lime-500"
						: "bg-rose-500";
export const laneCardClass = (title: string): string =>
	title === "Blocked"
		? "border-rose-500/30 bg-rose-500/5"
		: title === "Review"
			? "border-violet-500/30 bg-violet-500/5"
			: title === "In Progress"
				? "border-sky-500/30 bg-sky-500/5"
				: title === "Todo"
					? "border-blue-500/30 bg-blue-500/5"
					: "bg-card/85";
export const laneBadgeClass = (lane: PlannerLane): string => {
	if (lane === "todo") return "bg-blue-500 text-white";
	if (lane === "ready") return "bg-emerald-500 text-white";
	if (lane === "in_progress") return "bg-sky-500 text-white";
	if (lane === "review") return "bg-violet-500 text-white";
	if (lane === "done") return "bg-lime-500 text-black";
	if (lane === "blocked") return "bg-rose-500 text-white";
	return "bg-muted text-muted-foreground";
};
export const issueClass = (severity: PlannerIssue["severity"]): string =>
	severity === "critical"
		? "border-l-red-500"
		: severity === "warning"
			? "border-l-amber-500"
			: "border-l-sky-500";
export const issueBadgeClass = (severity: PlannerIssue["severity"]): string =>
	severity === "critical"
		? "bg-red-600 text-white"
		: severity === "warning"
			? "bg-amber-500 text-black"
			: "bg-sky-500 text-white";
