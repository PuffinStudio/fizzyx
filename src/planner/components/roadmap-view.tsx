import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
};

const MIN_DAY_WIDTH = "13rem";
const DRAG_TRIGGER_PX = 170;
const DRAG_CLICK_SUPPRESS_PX = 8;
const DRAG_CLICK_SUPPRESS_MS = 220;
const ASYNC_DELAY_MS = 130;
const AUTO_ALIGN_RETRY_LIMIT = 8;
const MONTH_INDEX_SEPARATOR = "-";
const TODAY_LINE_WIDTH_PX = 1;
const TODAY_LINE_RIGHT_GUTTER_PX = 10;

const startOfMonth = (value: Date): Date => new Date(value.getFullYear(), value.getMonth(), 1);

const monthKey = (value: Date): string => `${value.getFullYear()}-${value.getMonth()}`;

const parseMonthKey = (month: string): Date | null => {
	const items = month.split(MONTH_INDEX_SEPARATOR);
	if (items.length !== 2) return null;
	const yearValue = Number(items[0]);
	const monthValue = Number(items[1]);
	if (Number.isNaN(yearValue) || Number.isNaN(monthValue)) return null;
	return new Date(yearValue, monthValue, 1);
};

const parseDateKey = (dateKey: string): Date | null => {
	const parts = dateKey.split(MONTH_INDEX_SEPARATOR);
	if (parts.length < 3) return null;
	const yearValue = Number(parts[0]);
	const monthValue = Number(parts[1]);
	const dayValue = Number(parts[2]);
	if (Number.isNaN(yearValue) || Number.isNaN(monthValue) || Number.isNaN(dayValue)) {
		return null;
	}
	return new Date(yearValue, monthValue - 1, dayValue);
};

const compareMonthKey = (left: string, right: string): number => {
	const leftParts = left.split(MONTH_INDEX_SEPARATOR).map(Number);
	const rightParts = right.split(MONTH_INDEX_SEPARATOR).map(Number);
	if (leftParts.length < 2 || rightParts.length < 2) return 0;
	const leftYear = leftParts[0];
	const leftMonth = leftParts[1];
	const rightYear = rightParts[0];
	const rightMonth = rightParts[1];
	if (
		leftYear === undefined ||
		leftMonth === undefined ||
		rightYear === undefined ||
		rightMonth === undefined
	) {
		return 0;
	}
	if (
		Number.isNaN(leftYear) ||
		Number.isNaN(leftMonth) ||
		Number.isNaN(rightYear) ||
		Number.isNaN(rightMonth)
	) {
		return 0;
	}
	return leftYear === rightYear ? leftMonth - rightMonth : leftYear - rightYear;
};

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
		return [startOfMonth(initial)];
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
		setMonthStarts([initialMonthStart]);
	}, [baseMonthKey]);

	const timelineDays = useMemo<TimelineDay[]>(() => {
		return monthStarts.flatMap((monthStart) => buildTimelineDays(monthStart));
	}, [monthStarts]);

	const cardMonthStarts = useMemo(() => {
		const monthSet = new Set<string>();
		for (const card of metrics.timelineCards) {
			const parsed = parseDateKey(card.dateKey);
			if (!parsed) continue;
			monthSet.add(monthKey(startOfMonth(parsed)));
		}
		const sorted = [...monthSet].sort(compareMonthKey);
		return sorted.map((item) => parseMonthKey(item)).filter(Boolean) as Date[];
	}, [metrics.timelineCards]);

	const columnTemplate = useMemo(
		() => `repeat(${timelineDays.length}, minmax(${MIN_DAY_WIDTH}, 1fr))`,
		[timelineDays.length],
	);
	const cardMonthKeys = useMemo(() => cardMonthStarts.map(monthKey), [cardMonthStarts]);
	const [todayLineLeftPx, setTodayLineLeftPx] = useState(0);
	const [isTodayLineAvailable, setIsTodayLineAvailable] = useState(false);
	const visibleMonthKeys = useMemo(() => monthStarts.map(monthKey), [monthStarts]);
	const firstVisibleMonthIndex = useMemo(() => {
		const first = visibleMonthKeys[0];
		if (!first) return -1;
		return cardMonthKeys.indexOf(first);
	}, [cardMonthKeys, visibleMonthKeys]);
	const lastVisibleMonthIndex = useMemo(() => {
		const last = visibleMonthKeys[visibleMonthKeys.length - 1];
		if (!last) return -1;
		return cardMonthKeys.lastIndexOf(last);
	}, [cardMonthKeys, visibleMonthKeys]);

	const prevCardMonthKey = useCallback(
		(month: string): string | undefined => {
			if (cardMonthKeys.length === 0) return undefined;
			const firstAtOrAfter = cardMonthKeys.findIndex((key) => compareMonthKey(key, month) >= 0);
			if (firstAtOrAfter <= 0) {
				if (firstAtOrAfter === -1) return cardMonthKeys[cardMonthKeys.length - 1];
				return undefined;
			}
			return cardMonthKeys[firstAtOrAfter - 1];
		},
		[cardMonthKeys],
	);
	const nextCardMonthKey = useCallback(
		(month: string): string | undefined => {
			if (cardMonthKeys.length === 0) return undefined;
			const firstAtOrAfter = cardMonthKeys.findIndex((key) => compareMonthKey(key, month) > 0);
			if (firstAtOrAfter === -1) return undefined;
			return cardMonthKeys[firstAtOrAfter];
		},
		[cardMonthKeys],
	);

	const canLoadMoreLeft = useMemo(() => {
		const first = visibleMonthKeys[0];
		if (!first) return false;
		if (firstVisibleMonthIndex > 0) return true;
		if (firstVisibleMonthIndex === -1) return Boolean(prevCardMonthKey(first));
		return false;
	}, [firstVisibleMonthIndex, prevCardMonthKey, visibleMonthKeys]);
	const canLoadMoreRight = useMemo(() => {
		const last = visibleMonthKeys[visibleMonthKeys.length - 1];
		if (!last) return false;
		if (lastVisibleMonthIndex > -1) return lastVisibleMonthIndex < cardMonthKeys.length - 1;
		return Boolean(nextCardMonthKey(last));
	}, [cardMonthKeys.length, lastVisibleMonthIndex, nextCardMonthKey, visibleMonthKeys]);

	const canLoadMoreLeftRef = useRef(canLoadMoreLeft);
	const canLoadMoreRightRef = useRef(canLoadMoreRight);
	useEffect(() => {
		canLoadMoreLeftRef.current = canLoadMoreLeft;
	}, [canLoadMoreLeft]);
	useEffect(() => {
		canLoadMoreRightRef.current = canLoadMoreRight;
	}, [canLoadMoreRight]);
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
				return { ...card, startColumn, span };
			})
			.filter((card): card is PositionedTimelineCard => card !== null)
			.sort((a, b) => {
				if (a.startColumn !== b.startColumn) return a.startColumn - b.startColumn;
				return a.startDay - b.startDay;
			});
	}, [byDayKey, metrics.timelineCards, timelineDays.length]);

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
		if (!canLoadMoreLeftRef.current) return;
		loadingLeftRef.current = true;
		setLoadingLeft(true);
		await sleep();
		setMonthStarts((months) => {
			const firstMonth = months[0];
			if (!firstMonth) return months;
			const firstMonthKey = monthKey(firstMonth);
			const prevMonthKey = prevCardMonthKey(firstMonthKey);
			if (!prevMonthKey) return months;
			const prevMonthStart = parseMonthKey(prevMonthKey);
			if (!prevMonthStart) return months;
			if (months.some((month) => monthKey(month) === prevMonthKey)) return months;
			return [prevMonthStart, ...months];
		});
		setLoadingLeft(false);
		loadingLeftRef.current = false;
	};

	const appendMonth = async () => {
		if (loadingRightRef.current || !canLoadMoreRightRef.current) return;
		loadingRightRef.current = true;
		setLoadingRight(true);
		await sleep();
		setMonthStarts((months) => {
			const lastMonth = months[months.length - 1];
			if (!lastMonth) return months;
			const lastMonthKey = monthKey(lastMonth);
			const nextMonthKey = nextCardMonthKey(lastMonthKey);
			if (!nextMonthKey) return months;
			const nextMonthStart = parseMonthKey(nextMonthKey);
			if (!nextMonthStart) return months;
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
	template,
	onSelect,
	blockSelection,
}: {
	card: TimelineCard;
	startColumn: number;
	span: number;
	template: string;
	onSelect: SelectCard;
	blockSelection: () => boolean;
}) {
	return (
		<div className="grid w-full px-3" style={{ gridTemplateColumns: template }}>
			<div
				className="cursor-pointer rounded-lg bg-muted/35 p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-muted/50"
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
