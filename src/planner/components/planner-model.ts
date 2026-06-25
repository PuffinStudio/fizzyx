import type { PlannerCard, PlannerLane, PlannerSnapshot } from "./planner-types";

export type ProjectMetrics = {
	total: number;
	done: number;
	active: number;
	blocked: number;
	review: number;
	progressPercent: number;
	stepPercent: number;
	completedSteps: number;
	totalSteps: number;
	workDays: number;
	velocity: number;
	laneProgress: Array<{ lane: PlannerLane; label: string; count: number; percent: number }>;
	priorityRows: Array<{ label: string; value: number; className: string }>;
	myCards: PlannerCard[];
	timelineDays: TimelineDay[];
	timelineCards: TimelineCard[];
	calendarDays: CalendarDay[];
};

export type TimelineDay = {
	date: Date;
	dateKey: string;
	label: string;
	short: string;
	isToday: boolean;
};

export type TimelineCard = PlannerCard & {
	dateKey: string;
	startDay: number;
	duration: number;
	progress: number;
	accent: string;
};

export type CalendarDay = {
	date: Date;
	label: string;
	cards: PlannerCard[];
	isToday: boolean;
};

const laneOrder: Array<{ lane: PlannerLane; label: string }> = [
	{ lane: "todo", label: "Todo" },
	{ lane: "ready", label: "Ready" },
	{ lane: "in_progress", label: "In Progress" },
	{ lane: "review", label: "Review" },
	{ lane: "done", label: "Done" },
	{ lane: "blocked", label: "Blocked" },
];

const MS_PER_DAY = 86_400_000;
const DAY_KEY_PAD = (value: number): string => value.toString().padStart(2, "0");

export const dateKeyFromDate = (value: Date): string =>
	`${value.getFullYear()}-${DAY_KEY_PAD(value.getMonth() + 1)}-${DAY_KEY_PAD(value.getDate())}`;

export const dayStartIndex = (value: string): number => {
	const datePart = value.slice(0, 10);
	const [year, month, day] = datePart.split("-").map((item) => Number(item)) as [
		number,
		number,
		number,
	];
	return Math.floor(new Date(year, month - 1, day).getTime() / MS_PER_DAY);
};

export const deriveProjectMetrics = (
	snapshot: PlannerSnapshot,
	now = new Date(),
): ProjectMetrics => {
	const cards = snapshot.cards;
	const total = cards.length;
	const done = cards.filter((card) => card.lane === "done").length;
	const active = cards.filter((card) => card.lane === "in_progress").length;
	const blocked = cards.filter((card) => card.lane === "blocked").length;
	const review = cards.filter((card) => card.lane === "review").length;
	const completedSteps = cards.reduce((sum, card) => sum + card.stepProgress.completed, 0);
	const totalSteps = cards.reduce((sum, card) => sum + card.stepProgress.total, 0);
	const progressPercent = total === 0 ? 0 : Math.round((done / total) * 100);
	const stepPercent =
		totalSteps === 0 ? progressPercent : Math.round((completedSteps / totalSteps) * 100);
	const firstDate = cards.map(cardDate).filter(Boolean).sort()[0];
	const workDays = firstDate ? Math.max(1, daysBetween(new Date(firstDate), now) + 1) : 1;
	const velocity = Math.round((done / workDays) * 10) / 10;
	const myCards = snapshot.identity
		? cards.filter((card) => card.assignees.some((user) => user.id === snapshot.identity?.id))
		: [];

	return {
		total,
		done,
		active,
		blocked,
		review,
		progressPercent,
		stepPercent,
		completedSteps,
		totalSteps,
		workDays,
		velocity,
		laneProgress: laneOrder.map(({ lane, label }) => {
			const count = snapshot.summary.lanes[lane] || 0;
			return { lane, label, count, percent: total === 0 ? 0 : Math.round((count / total) * 100) };
		}),
		priorityRows: [
			{ label: "P0 Critical", value: snapshot.summary.priorities.p0, className: "bg-red-500" },
			{ label: "P1 High", value: snapshot.summary.priorities.p1, className: "bg-amber-500" },
			{ label: "P2 Normal", value: snapshot.summary.priorities.p2, className: "bg-sky-500" },
		],
		myCards,
		timelineDays: buildTimelineDays(now),
		timelineCards: buildTimelineCards(cards),
		calendarDays: buildCalendarDays(cards, now),
	};
};

export const getCardProgress = (card: PlannerCard): number => {
	if (card.stepProgress.total > 0)
		return Math.round((card.stepProgress.completed / card.stepProgress.total) * 100);
	if (card.lane === "done") return 100;
	if (card.lane === "review") return 80;
	if (card.lane === "in_progress") return 55;
	if (card.lane === "ready") return 25;
	return 5;
};

export const cardDate = (card: PlannerCard): string | undefined =>
	card.metadata.deadline || card.createdAt;

const buildTimelineCards = (cards: PlannerCard[]): TimelineCard[] => {
	const entries = cards
		.map((card) => {
			const date = cardDate(card);
			if (!date) return null;
			return {
				card,
				dateKey: date.slice(0, 10),
				startDay: dayStartIndex(date),
				duration: card.lane === "done" ? 1 : card.lane === "in_progress" ? 3 : 2,
			};
		})
		.filter(
			(
				entry,
			): entry is { card: PlannerCard; dateKey: string; startDay: number; duration: number } =>
				entry !== null,
		)
		.sort((a, b) => {
			if (a.startDay !== b.startDay) return a.startDay - b.startDay;
			return laneWeight(a.card.lane) - laneWeight(b.card.lane);
		});

	return entries.map(({ card, dateKey, startDay, duration }) => ({
		...card,
		dateKey,
		startDay,
		duration,
		progress: getCardProgress(card),
		accent: timelineAccent(card),
	}));
};

export const timelineMonthBounds = (reference: Date): { start: Date; end: Date } => {
	return {
		start: new Date(reference.getFullYear(), reference.getMonth(), 1),
		end: new Date(reference.getFullYear(), reference.getMonth() + 1, 0),
	};
};

export const buildTimelineDays = (reference: Date): TimelineDay[] => {
	const today = new Date();
	const { start, end } = timelineMonthBounds(reference);
	const out: TimelineDay[] = [];
	const cursor = new Date(start);
	while (cursor <= end) {
		out.push({
			date: new Date(cursor),
			dateKey: dateKeyFromDate(cursor),
			label: cursor.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
			short: cursor.toLocaleDateString(undefined, { weekday: "short" }),
			isToday: cursor.toDateString() === today.toDateString(),
		});
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
};

const buildCalendarDays = (cards: PlannerCard[], now: Date): CalendarDay[] => {
	const start = new Date(now);
	start.setDate(now.getDate() - 3);
	const today = new Date();
	return Array.from({ length: 14 }, (_, index) => {
		const date = new Date(start);
		date.setDate(start.getDate() + index);
		const dayKey = dateKeyFromDate(date);
		return {
			date,
			label: date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
			cards: cards.filter((card) => (cardDate(card) || "").slice(0, 10) === dayKey),
			isToday: date.toDateString() === today.toDateString(),
		};
	});
};

const laneWeight = (lane: PlannerLane): number => {
	if (lane === "todo") return 0;
	if (lane === "ready") return 1;
	if (lane === "in_progress") return 2;
	if (lane === "review") return 3;
	if (lane === "done") return 4;
	if (lane === "blocked") return 5;
	return 6;
};

const timelineAccent = (card: PlannerCard): string => {
	const priority = card.metadata.priority?.toLowerCase() || card.parsedTags.priority[0];
	if (priority === "p0") return "bg-red-500";
	if (priority === "p1") return "bg-amber-500";
	if (card.lane === "done") return "bg-lime-500";
	if (card.lane === "blocked") return "bg-rose-500";
	return "bg-primary";
};

const daysBetween = (start: Date, end: Date): number =>
	Math.floor((end.getTime() - start.getTime()) / MS_PER_DAY);
