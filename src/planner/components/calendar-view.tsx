import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { buildMonthCalendarDays, type CalendarDay } from "./planner-model";
import type { SelectCard } from "./planner-types";
import type { PlannerCard } from "./planner-types";

const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarView({
	cards,
	onSelect,
	onNavigateToMyCards,
}: {
	cards: ReadonlyArray<PlannerCard>;
	onSelect: SelectCard;
	onNavigateToMyCards?: () => void;
}) {
	const [visibleMonth, setVisibleMonth] = useState(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});

	const days: CalendarDay[] = useMemo(
		() => buildMonthCalendarDays(cards, visibleMonth),
		[cards, visibleMonth],
	);

	const monthLabel = visibleMonth.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});

	const now = new Date();
	const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const canJumpToToday =
		visibleMonth.getFullYear() !== thisMonth.getFullYear() ||
		visibleMonth.getMonth() !== thisMonth.getMonth();

	const nav = (delta: number) => {
		setVisibleMonth((current) => {
			const next = new Date(current);
			next.setMonth(next.getMonth() + delta);
			return new Date(next.getFullYear(), next.getMonth(), 1);
		});
	};

	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
		>
			<section className="overflow-hidden rounded-xl bg-muted/20 p-4">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-base font-semibold">Planning Calendar</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Cards are placed by deadline metadata when available, otherwise by latest activity or
							comments.
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{onNavigateToMyCards ? (
							<button
								type="button"
								onClick={onNavigateToMyCards}
								className="whitespace-nowrap rounded-full text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
							>
								View My Cards
							</button>
						) : null}
						<div className="inline-flex rounded-full border border-sidebar-border/30 bg-background/60 p-1">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => nav(-1)}
								aria-label="Previous month"
							>
								<ChevronLeft className="size-3.5" />
							</Button>
							<span className="flex min-w-40 justify-center px-3 text-sm font-medium text-foreground/90">
								{monthLabel}
							</span>
							<Button variant="ghost" size="icon-sm" onClick={() => nav(1)} aria-label="Next month">
								<ChevronRight className="size-3.5" />
							</Button>
						</div>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setVisibleMonth(thisMonth)}
							disabled={!canJumpToToday}
							className="rounded-full"
						>
							<RotateCcw className="size-3.5" />
							Today
						</Button>
					</div>
				</div>
				<div className="mt-4 grid grid-cols-7 gap-2 text-xs uppercase tracking-wide text-muted-foreground">
					{weekdayNames.map((name) => (
						<div key={name} className="px-2 py-2">
							{name}
						</div>
					))}
				</div>
				<div className="mt-1 grid gap-3 md:grid-cols-7">
					{days.map((day, index) => (
						<motion.div
							key={day.date.toISOString()}
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ delay: index * 0.01, duration: 0.2 }}
							className={cn(
								"min-h-24 overflow-hidden rounded-xl p-3",
								day.isCurrentMonth ? "bg-muted/30" : "bg-muted/15",
								day.isToday ? "ring-2 ring-primary/40" : "",
								!day.isCurrentMonth ? "text-muted-foreground/70" : "",
							)}
						>
							<div className="mb-3 flex items-center justify-between">
								<div className="flex items-center gap-2">
									<p className="text-sm font-semibold">{day.label}</p>
									<span className="text-[11px] text-muted-foreground">{day.short}</span>
								</div>
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
