import { useEffect, useMemo, useRef, useState } from "react";
import { animate, motion, type PanInfo, useMotionValue } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
	buildTimelineDays,
	dateKeyFromDate,
	type ProjectMetrics,
	type TimelineCard,
	type TimelineDay,
} from "./planner-model";
import type { SelectCard } from "./planner-types";
import { laneBadgeClass } from "./planner-style";
import { UserAvatarLabel } from "./user-avatar-label";

type PositionedTimelineCard = TimelineCard & {
	startColumn: number;
	span: number;
	isToday: boolean;
};

const MIN_DAY_WIDTH = "13rem";
const DRAG_TRIGGER_PX = 170;
const DRAG_CLICK_SUPPRESS_PX = 8;
const DRAG_CLICK_SUPPRESS_MS = 220;
const ASYNC_DELAY_MS = 130;
const AUTO_ALIGN_RETRY_LIMIT = 8;
const TODAY_LINE_WIDTH_PX = 1;
const TODAY_LINE_RIGHT_GUTTER_PX = 10;

const startOfMonth = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), 1);

const addMonths = (value: Date, count: number): Date =>
	startOfMonth(new Date(value.getFullYear(), value.getMonth() + count, 1));

const monthKey = (value: Date): string => `${value.getFullYear()}-${value.getMonth()}`;

export function RoadmapView({
	metrics,
	onSelect,
}: {
	metrics: ProjectMetrics;
	onSelect: SelectCard;
}) {
	return (
		<motion.div
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
		>
			<section className="min-w-0 w-full max-w-full overflow-hidden overflow-x-hidden rounded-xl bg-muted/20 p-4">
				<div className="mb-3 flex items-center justify-between">
					<div>
						<h2 className="text-base font-semibold">Project Roadmap</h2>
						<p className="text-xs text-muted-foreground">
							Drag to navigate · Today centered on load
						</p>
					</div>
				</div>
				<RoadmapPreview metrics={metrics} onSelect={onSelect} />
			</section>
		</motion.div>
	);
}

export function RoadmapPreview({
	metrics,
	onSelect,
}: {
	metrics: ProjectMetrics;
	onSelect: SelectCard;
}) {
	const [grabbing, setGrabbing] = useState(false);
	const [loadingLeft, setLoadingLeft] = useState(false);
	const [loadingRight, setLoadingRight] = useState(false);
	const [monthStarts, setMonthStarts] = useState<Date[]>(() => {
		const initial = startOfMonth(new Date());
		return [addMonths(initial, -1), startOfMonth(initial), addMonths(initial, 1)];
	});
	const translateX = useMotionValue(0);
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const loadingLeftRef = useRef(false);
	const loadingRightRef = useRef(false);
	const alignRafRef = useRef<number>(0);
	const alignRetryRef = useRef(0);
	const blockClickUntil = useRef(0);

	const initialMonthStart = useMemo(() => startOfMonth(new Date()), []);
	const baseMonthKey = monthKey(initialMonthStart);
	const todayDate = new Date();
	const todayDateKey = dateKeyFromDate(todayDate);

	useEffect(() => {
		setMonthStarts([
			addMonths(initialMonthStart, -1),
			initialMonthStart,
			addMonths(initialMonthStart, 1),
		]);
	}, [baseMonthKey]);

	const timelineDays = useMemo<TimelineDay[]>(() => {
		return monthStarts.flatMap((monthStart) => buildTimelineDays(monthStart));
	}, [monthStarts]);

	const columnTemplate = useMemo(
		() => `repeat(${timelineDays.length}, minmax(${MIN_DAY_WIDTH}, 1fr))`,
		[timelineDays.length],
	);
	const [todayLineLeftPx, setTodayLineLeftPx] = useState(0);
	const [isTodayLineAvailable, setIsTodayLineAvailable] = useState(false);
	const byDayKey = useMemo(() => {
		const map = new Map<string, number>();
		timelineDays.forEach((day, index) => {
			map.set(day.dateKey, index + 1);
		});
		return map;
	}, [timelineDays]);

	const cardsInWindow = useMemo(() => {
		if (timelineDays.length === 0) return [] as PositionedTimelineCard[];
		return metrics.timelineCards
			.map((card) => {
				const startColumn = byDayKey.get(card.dateKey);
				if (!startColumn) return null;
				const span = Math.max(1, Math.min(card.duration, timelineDays.length - startColumn + 1));
				const todayColumn = byDayKey.get(todayDateKey);
				const isToday =
					todayColumn !== undefined &&
					todayColumn >= startColumn &&
					todayColumn < startColumn + span;
				return { ...card, startColumn, span, isToday };
			})
			.filter((card): card is PositionedTimelineCard => card !== null)
			.sort((a, b) => {
				if (a.isToday !== b.isToday) return a.isToday ? -1 : 1;
				if (a.startColumn !== b.startColumn) return a.startColumn - b.startColumn;
				return a.startDay - b.startDay;
			});
	}, [byDayKey, metrics.timelineCards, timelineDays.length, todayDateKey]);

	useEffect(() => {
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) return;
		const dayCell = track.querySelector<HTMLElement>(`[data-date-key="${todayDateKey}"]`);
		if (!dayCell) {
			setIsTodayLineAvailable(false);
			return;
		}
		const trackRect = track.getBoundingClientRect();
		const dayRect = dayCell.getBoundingClientRect();
		setIsTodayLineAvailable(true);
		const dayWidth = Math.max(dayRect.width, 1);
		const safeRight = Math.max(dayWidth - TODAY_LINE_RIGHT_GUTTER_PX, 0);
		const left = Math.min(
			dayRect.left - trackRect.left + safeRight,
			trackRect.width - TODAY_LINE_WIDTH_PX,
		);
		setTodayLineLeftPx(left);
	}, [todayDateKey, timelineDays.length, monthStarts.length]);

	useEffect(() => {
		if (!isTodayLineAvailable) return;
		scheduleAlignDateToCenter(todayDateKey);
	}, [isTodayLineAvailable, todayDateKey]);

	const sleep = () =>
		new Promise((resolve) => {
			setTimeout(resolve, ASYNC_DELAY_MS);
		});

	const prependMonth = async () => {
		if (loadingLeftRef.current) return;
		loadingLeftRef.current = true;
		setLoadingLeft(true);
		await sleep();
		setMonthStarts((months) => {
			const firstMonth = months[0];
			if (!firstMonth) return months;
			const prevMonthStart = addMonths(firstMonth, -1);
			const prevMonthKey = monthKey(prevMonthStart);
			if (months.some((month) => monthKey(month) === prevMonthKey)) return months;
			return [prevMonthStart, ...months];
		});
		setLoadingLeft(false);
		loadingLeftRef.current = false;
	};

	const appendMonth = async () => {
		if (loadingRightRef.current) return;
		loadingRightRef.current = true;
		setLoadingRight(true);
		await sleep();
		setMonthStarts((months) => {
			const lastMonth = months[months.length - 1];
			if (!lastMonth) return months;
			const nextMonthStart = addMonths(lastMonth, 1);
			const nextMonthKey = monthKey(nextMonthStart);
			if (months.some((month) => monthKey(month) === nextMonthKey)) return months;
			return [...months, nextMonthStart];
		});
		setLoadingRight(false);
		loadingRightRef.current = false;
	};

	const alignDateToCenter = (dateKey?: string) => {
		if (!dateKey) return false;
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) return false;
		const dayCell = track.querySelector<HTMLElement>(`[data-date-key="${dateKey}"]`);
		if (!dayCell) return false;

		const viewportRect = viewport.getBoundingClientRect();
		const dayRect = dayCell.getBoundingClientRect();
		const targetX = viewportRect.left + viewportRect.width / 2 - (dayRect.left + dayRect.width / 2);
		if (Math.abs(targetX) < 0.25) return true;
		void animate(translateX, translateX.get() + targetX, {
			type: "spring",
			stiffness: 240,
			damping: 30,
		});
		return true;
	};

	const scheduleAlignDateToCenter = (dateKey?: string) => {
		alignRetryRef.current = 0;
		if (alignRafRef.current) {
			cancelAnimationFrame(alignRafRef.current);
		}
		const attempt = () => {
			alignRafRef.current = requestAnimationFrame(() => {
				alignRafRef.current = 0;
				const aligned = alignDateToCenter(dateKey);
				if (!aligned && alignRetryRef.current < AUTO_ALIGN_RETRY_LIMIT) {
					alignRetryRef.current += 1;
					attempt();
				}
			});
		};
		attempt();
	};

	useEffect(() => {
		translateX.set(0);
	}, [baseMonthKey]);

	useEffect(() => {
		return () => {
			if (alignRafRef.current) {
				cancelAnimationFrame(alignRafRef.current);
				alignRafRef.current = 0;
			}
		};
	}, []);

	const handleDragStart = () => {
		setGrabbing(true);
	};

	const handleDragEnd = async (_event: unknown, info: PanInfo) => {
		setGrabbing(false);
		if (Math.abs(info.offset.x) > DRAG_CLICK_SUPPRESS_PX) {
			blockClickUntil.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
		}
		if (info.offset.x > DRAG_TRIGGER_PX) {
			await prependMonth();
			return;
		}
		if (info.offset.x < -DRAG_TRIGGER_PX) {
			await appendMonth();
			return;
		}
	};

	const isSelectionBlocked = () => Date.now() < blockClickUntil.current;

	return (
		<div
			ref={viewportRef}
			className="min-w-0 relative w-full max-w-full overflow-hidden overflow-x-hidden rounded-xl"
		>
			<button
				type="button"
				className="absolute right-3 top-3 z-20 rounded-full border border-primary/30 bg-background/90 px-3 py-1.5 text-xs font-medium text-primary shadow-sm backdrop-blur transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={() => scheduleAlignDateToCenter(todayDateKey)}
			>
				Today
			</button>
			<motion.div
				ref={trackRef}
				drag="x"
				dragConstraints={false}
				dragElastic={0}
				dragMomentum={false}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
				style={{ x: translateX, willChange: "transform", touchAction: "pan-y" }}
				className={`pb-2 select-none ${grabbing ? "cursor-grabbing" : "cursor-grab"}`}
			>
				<div className="inline-block bg-background/50">
					<div
						className="grid border-b border-border/30 bg-muted/15 text-center text-xs text-muted-foreground"
						style={{ gridTemplateColumns: columnTemplate }}
					>
						{timelineDays.map((day) => {
							const isToday = day.dateKey === todayDateKey;
							return (
								<div
									data-date-key={day.dateKey}
									key={day.dateKey}
									className={`border-r border-border/30 px-3 py-2 text-left last:border-r-0 ${
										isToday ? "bg-muted/40" : ""
									}`}
								>
									<p className="truncate font-medium">{day.label}</p>
									<p className="truncate text-[11px]">{isToday ? "Today" : day.short}</p>
								</div>
							);
						})}
					</div>
					<div className="relative space-y-2 pt-4">
						{timelineDays.length > 0 ? (
							<div
								className="absolute top-0 bottom-0 pointer-events-none"
								style={{
									left: isTodayLineAvailable
										? `calc(${todayLineLeftPx}px - ${TODAY_LINE_WIDTH_PX / 2}px)`
										: "50%",
								}}
							>
								<div className="h-full w-px bg-primary/75" />
								<button
									type="button"
									className="pointer-events-auto absolute left-0 -translate-y-1/2 -top-1 flex items-center rounded border border-primary/30 bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
									onClick={() => scheduleAlignDateToCenter(todayDateKey)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											scheduleAlignDateToCenter(todayDateKey);
										}
									}}
								>
									Today
								</button>
							</div>
						) : null}
						{(loadingLeft || loadingRight) && (
							<p className="absolute left-2 top-1 z-10 rounded-full bg-background px-2 py-1 text-xs text-muted-foreground">
								Loading more dates…
							</p>
						)}
						{cardsInWindow.length === 0 ? (
							<p className="px-3 text-sm text-muted-foreground">
								No cards to place on the timeline.
							</p>
						) : null}
						{cardsInWindow.map((card, i) => (
							<motion.div
								key={card.number}
								initial={{ opacity: 0, x: -16 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ delay: i * 0.03, duration: 0.3 }}
							>
								<TimelineBar
									card={card}
									startColumn={card.startColumn}
									span={card.span}
									isToday={card.isToday}
									template={columnTemplate}
									onSelect={onSelect}
									blockSelection={isSelectionBlocked}
								/>
							</motion.div>
						))}
					</div>
				</div>
			</motion.div>
		</div>
	);
}

function TimelineBar({
	card,
	startColumn,
	span,
	isToday,
	template,
	onSelect,
	blockSelection,
}: {
	card: TimelineCard;
	startColumn: number;
	span: number;
	isToday: boolean;
	template: string;
	onSelect: SelectCard;
	blockSelection: () => boolean;
}) {
	return (
		<div className="grid w-full px-3" style={{ gridTemplateColumns: template }}>
			<div
				className={`cursor-pointer rounded-lg p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
					isToday
						? "bg-primary/12 ring-2 ring-primary/45 shadow-sm hover:bg-primary/16"
						: "bg-muted/35 hover:bg-muted/50"
				}`}
				data-roadmap-card
				style={{ gridColumn: `${startColumn} / span ${span}` }}
				onPointerDownCapture={(event) => {
					if (blockSelection()) {
						event.preventDefault();
					}
				}}
				onClick={(event) => {
					if (blockSelection()) {
						event.preventDefault();
						event.stopPropagation();
						return;
					}
					onSelect(card);
				}}
				onKeyDown={(e) => {
					if (blockSelection()) {
						e.preventDefault();
						return;
					}
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						onSelect(card);
					}
				}}
				role="button"
				tabIndex={0}
			>
				<div className="flex items-start gap-2">
					{card.assignees[0] ? (
						<UserAvatarLabel user={card.assignees[0]} compact size="sm" />
					) : (
						<div className={`mt-0.5 h-6 w-1 shrink-0 rounded-full ${card.accent}`} />
					)}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-1.5">
							<Badge variant="outline" className="rounded-full text-[10px] leading-none px-1 py-0">
								#{card.number}
							</Badge>
							<Badge
								className={`${laneBadgeClass(card.lane)} rounded-full text-[10px] leading-none px-1 py-0`}
							>
								{card.lane.replace("_", " ")}
							</Badge>
						</div>
						<p className="mt-0.5 truncate text-xs font-medium">{card.title}</p>
						{card.assignees.slice(1, 2).map((user) => (
							<div key={user.id} className="mt-1">
								<UserAvatarLabel user={user} compact size="sm" />
							</div>
						))}
						<Progress className="mt-1.5 h-1" value={card.progress} />
					</div>
				</div>
			</div>
		</div>
	);
}
