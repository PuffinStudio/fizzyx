import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import type { ProjectMetrics } from "./planner-model";
import type { SelectCard } from "./planner-types";

export function CalendarView({
	metrics,
	onSelect,
	onNavigateToMyCards,
}: {
	metrics: ProjectMetrics;
	onSelect: SelectCard;
	onNavigateToMyCards?: () => void;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
		>
			<section className="rounded-xl bg-muted/20 p-4">
				<div className="flex flex-row items-start justify-between gap-4">
					<div>
						<h2 className="text-base font-semibold">Planning Calendar</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Cards are placed by deadline metadata when available, otherwise by latest activity or
							comments.
						</p>
					</div>
					{onNavigateToMyCards ? (
						<button
							type="button"
							onClick={onNavigateToMyCards}
							className="whitespace-nowrap rounded-full text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
						>
							View My Cards
						</button>
					) : null}
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-7">
					{metrics.calendarDays.map((day, i) => (
						<motion.div
							key={day.date.toISOString()}
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ delay: i * 0.02, duration: 0.25 }}
							className={`min-h-36 rounded-xl p-3 ${day.isToday ? "bg-muted/40" : "bg-muted/20"}`}
						>
							<div className="mb-3 flex items-center justify-between">
								<p className="text-sm font-medium">{day.label}</p>
								{day.isToday ? <Badge className="rounded-full">Today</Badge> : null}
							</div>
							<div className="space-y-2">
								{day.cards.slice(0, 3).map((card) => (
									<button
										key={card.number}
										type="button"
										onClick={() => onSelect(card)}
										className="w-full rounded-lg bg-muted/50 p-2 text-left text-xs hover:bg-muted"
									>
										<span className="font-medium">#{card.number}</span> {card.title}
									</button>
								))}
								{day.cards.length > 3 && onNavigateToMyCards ? (
									<button
										type="button"
										onClick={onNavigateToMyCards}
										className="text-xs text-muted-foreground hover:text-foreground hover:underline"
									>
										+{day.cards.length - 3} more
									</button>
								) : day.cards.length > 3 ? (
									<p className="text-xs text-muted-foreground">+{day.cards.length - 3} more</p>
								) : null}
							</div>
						</motion.div>
					))}
				</div>
			</section>
		</motion.div>
	);
}
