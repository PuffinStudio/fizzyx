import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { PlannerCardItem } from "./planner-card-item";
import { laneBarClass, laneCardClass } from "./planner-style";
import type { PlannerCard, SelectCard } from "./planner-types";

const lanes = [
	{ key: "todo", label: "Todo" },
	{ key: "ready", label: "Ready" },
	{ key: "in_progress", label: "In Progress" },
	{ key: "review", label: "Review" },
	{ key: "done", label: "Done" },
	{ key: "blocked", label: "Blocked" },
] as const;

export function BoardView({
	cards,
	onSelect,
}: {
	cards: ReadonlyArray<PlannerCard>;
	onSelect: SelectCard;
}) {
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.3 }}
			className="space-y-4"
		>
			<section className="grid min-w-0 grid-cols-6 gap-3 overflow-hidden">
				{lanes.map((lane, i) => (
					<motion.div
						key={lane.key}
						className="min-w-0"
						initial={{ opacity: 0, y: 12 }}
						animate={{ opacity: 1, y: 0 }}
						transition={{ delay: i * 0.05, duration: 0.3 }}
					>
						<LaneColumn
							title={lane.label}
							cards={cards.filter((card) => card.lane === lane.key)}
							onSelect={onSelect}
						/>
					</motion.div>
				))}
			</section>
		</motion.div>
	);
}

function LaneColumn({
	title,
	cards,
	onSelect,
}: {
	title: string;
	cards: ReadonlyArray<PlannerCard>;
	onSelect: SelectCard;
}) {
	return (
		<section
			className={`flex h-[calc(100vh-12rem)] min-w-0 flex-col overflow-hidden rounded-xl bg-muted/20 p-3 ${laneCardClass(title)}`}
		>
			<div className={`h-1 shrink-0 rounded-full ${laneBarClass(title)}`} />
			<div className="mb-3 flex shrink-0 items-center justify-between gap-2">
				<p className="text-sm font-medium">{title}</p>
				<Badge variant="secondary" className="rounded-full">
					{cards.length}
				</Badge>
			</div>
			<div className="no-scrollbar scroll-fade min-w-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden">
				{cards.map((card) => (
					<PlannerCardItem key={card.number} card={card} compact onSelect={onSelect} />
				))}
				{cards.length === 0 ? <p className="text-sm text-muted-foreground">No cards</p> : null}
			</div>
		</section>
	);
}
