import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCardProgress, type ProjectMetrics } from "./planner-model";
import type { PlannerCard, PlannerLane, PlannerSnapshot, SelectCard } from "./planner-types";
import { laneBadgeClass } from "./planner-style";
import { RoadmapPreview } from "./roadmap-view";

export function ProjectOverview({
	snapshot,
	metrics,
	onSelect,
	onNavigateToMyCards,
}: {
	snapshot: PlannerSnapshot;
	metrics: ProjectMetrics;
	onSelect: SelectCard;
	onNavigateToMyCards?: () => void;
}) {
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.3 }}
			className="space-y-4"
		>
			<section className="grid gap-3 xl:grid-cols-6">
				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.05, duration: 0.35 }}
					className="flex"
				>
					<section className="flex w-full flex-col rounded-xl bg-muted/20 p-4">
						<div className="mb-2 flex items-center justify-between gap-2">
							<div>
								<Badge className="mb-1 rounded-full bg-primary/15 text-[10px] text-primary dark:text-primary px-1.5 py-0">
									Project
								</Badge>
								<h3 className="text-sm font-semibold leading-tight">{snapshot.boardName}</h3>
							</div>
							<CompletionDonut
								percent={metrics.progressPercent}
								size={46}
								label={`${metrics.done}/${metrics.total}`}
							/>
						</div>
						<div className="space-y-1.5">
							<Progress value={metrics.progressPercent} />
							<div className="flex justify-between text-[11px] text-muted-foreground">
								<span>
									Done <span className="text-foreground">{metrics.done}</span>
								</span>
								<span>
									Active <span className="text-foreground">{metrics.active + metrics.review}</span>
								</span>
								<span>
									Todo{" "}
									<span className="text-foreground">
										{metrics.total -
											metrics.done -
											metrics.active -
											metrics.review -
											metrics.blocked}
									</span>
								</span>
								<span>
									Blocked <span className="text-foreground">{metrics.blocked}</span>
								</span>
							</div>
						</div>
					</section>
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1, duration: 0.35 }}
					className="xl:col-span-3 flex"
				>
					<section className="flex w-full flex-col rounded-xl bg-muted/20 p-4">
						<div className="mb-1.5 flex items-baseline justify-between gap-2">
							{onNavigateToMyCards ? (
								<button
									type="button"
									onClick={onNavigateToMyCards}
									className="text-sm font-semibold hover:underline"
								>
									My Cards
								</button>
							) : (
								<h3 className="text-sm font-semibold">My Cards</h3>
							)}
							<p className="text-xs text-muted-foreground">{metrics.myCards.length} assigned</p>
						</div>
						{metrics.myCards.length === 0 ? (
							<p className="text-xs text-muted-foreground">No assigned cards.</p>
						) : (
							<div className="flex-1">
								<div className="grid grid-cols-3 gap-1">
									{metrics.myCards.slice(0, 6).map((card) => (
										<CompactCard key={card.number} card={card} onSelect={onSelect} />
									))}
								</div>
							</div>
						)}
						{metrics.myCards.length > 6 && onNavigateToMyCards ? (
							<button
								type="button"
								onClick={onNavigateToMyCards}
								className="mt-1 self-start text-xs text-muted-foreground hover:text-foreground hover:underline"
							>
								+{metrics.myCards.length - 6} more
							</button>
						) : metrics.myCards.length > 6 ? (
							<p className="mt-1 text-xs text-muted-foreground">
								+{metrics.myCards.length - 6} more
							</p>
						) : null}
					</section>
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.15, duration: 0.35 }}
					className="flex"
				>
					<section className="flex w-full flex-col rounded-xl bg-muted/20 p-4">
						<h3 className="mb-1 text-sm font-semibold">Lanes</h3>
						<div className="flex-1">
							<LaneMiniChart lanes={metrics.laneProgress} />
						</div>
					</section>
				</motion.div>
				<motion.div
					initial={{ opacity: 0, y: 16 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.2, duration: 0.35 }}
					className="flex"
				>
					<section className="flex w-full flex-col rounded-xl bg-muted/20 p-4">
						<h3 className="mb-1 text-sm font-semibold">Priority</h3>
						<div className="flex-1">
							<PriorityMiniChart rows={metrics.priorityRows} total={metrics.total} />
						</div>
					</section>
				</motion.div>
			</section>

			<motion.section
				initial={{ opacity: 0, y: 16 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ delay: 0.25, duration: 0.35 }}
				className="rounded-xl bg-muted/20 p-4"
			>
				<div className="mb-3 flex items-center justify-between">
					<div>
						<h3 className="text-sm font-semibold">Roadmap Preview</h3>
						<p className="text-xs text-muted-foreground">
							Drag to navigate · Today centered on load
						</p>
					</div>
				</div>
				<RoadmapPreview metrics={metrics} onSelect={onSelect} />
			</motion.section>
		</motion.div>
	);
}

function CompletionDonut({
	percent,
	size,
	label,
}: {
	percent: number;
	size: number;
	label: string;
}) {
	const strokeWidth = Math.max(4, Math.round(size * 0.06));
	const r = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * r;
	const offset = circumference * (1 - percent / 100);
	const mid = size / 2;
	return (
		<div className="flex items-center gap-2">
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
				<circle
					cx={mid}
					cy={mid}
					r={r}
					fill="none"
					className="stroke-muted/30"
					strokeWidth={strokeWidth}
				/>
				<motion.circle
					cx={mid}
					cy={mid}
					r={r}
					fill="none"
					className="stroke-primary"
					strokeWidth={strokeWidth}
					strokeDasharray={circumference}
					strokeDashoffset={circumference}
					strokeLinecap="round"
					transform={`rotate(-90 ${mid} ${mid})`}
					animate={{ strokeDashoffset: offset }}
					transition={{ duration: 0.6, ease: "easeOut" }}
				/>
				<text
					x={mid}
					y={mid}
					textAnchor="middle"
					dominantBaseline="central"
					fontSize={size * 0.22}
					fontWeight={700}
					fill="currentColor"
				>
					{percent}%
				</text>
			</svg>
			<div className="text-right">
				<p className="text-base font-bold leading-tight">{label}</p>
				<p className="text-[10px] text-muted-foreground">done</p>
			</div>
		</div>
	);
}

function LaneMiniChart({ lanes }: { lanes: ProjectMetrics["laneProgress"] }) {
	const maxCount = Math.max(...lanes.map((l) => l.count), 1);
	return (
		<div className="space-y-1">
			{lanes.map((lane) => (
				<div key={lane.lane} className="flex items-center gap-2">
					<span className="w-16 shrink-0 text-right text-[11px] capitalize text-muted-foreground">
						{lane.label}
					</span>
					<div className="flex-1 overflow-hidden rounded-sm bg-muted/20" style={{ height: 10 }}>
						<motion.div
							initial={{ width: 0 }}
							animate={{ width: `${(lane.count / maxCount) * 100}%` }}
							transition={{ duration: 0.5, ease: "easeOut" }}
							className="h-full rounded-sm"
							style={{ backgroundColor: laneColor(lane.lane) }}
						/>
					</div>
					<span className="w-5 text-right text-[11px] font-medium">{lane.count}</span>
				</div>
			))}
		</div>
	);
}

function PriorityMiniChart({
	rows,
	total,
}: {
	rows: ProjectMetrics["priorityRows"];
	total: number;
}) {
	return (
		<div className="space-y-1">
			{rows.map((row) => (
				<div key={row.label} className="flex items-center gap-2">
					<span className="w-20 shrink-0 text-right text-[11px] text-muted-foreground">
						{row.label}
					</span>
					<div className="flex-1 overflow-hidden rounded-sm bg-muted/20" style={{ height: 10 }}>
						<motion.div
							initial={{ width: 0 }}
							animate={{
								width: `${total === 0 ? 0 : Math.round((row.value / total) * 100)}%`,
							}}
							transition={{ duration: 0.5, ease: "easeOut" }}
							className="h-full rounded-sm"
							style={{ backgroundColor: priorityColor(row.label) }}
						/>
					</div>
					<span className="w-5 text-right text-[11px] font-medium">{row.value}</span>
				</div>
			))}
		</div>
	);
}

function priorityColor(label: string): string {
	if (label.startsWith("P0")) return "#ef4444";
	if (label.startsWith("P1")) return "#f59e0b";
	return "#0ea5e9";
}

function laneColor(lane: PlannerLane): string {
	switch (lane) {
		case "todo":
			return "#3b62f6";
		case "ready":
			return "#10b961";
		case "in_progress":
			return "#0ea5e9";
		case "review":
			return "#6b5cf6";
		case "done":
			return "#64cc16";
		case "blocked":
			return "#f43f5e";
	}
}

function CompactCard({ card, onSelect }: { card: PlannerCard; onSelect: SelectCard }) {
	const percent = getCardProgress(card);
	return (
		<button
			type="button"
			onClick={() => onSelect(card)}
			className="w-full rounded-md bg-background/90 p-1.5 text-left transition-colors hover:bg-muted/40"
		>
			<div className="flex items-center gap-1">
				<Badge className={`${laneBadgeClass(card.lane)} text-[10px] leading-none px-1 py-0`}>
					{card.lane.replace("_", " ")}
				</Badge>
			</div>
			<p className="truncate text-xs font-medium">
				#{card.number} {card.title}
			</p>
			<div className="mt-1">
				<Progress value={percent} />
			</div>
		</button>
	);
}
