import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TeamChat } from "./components/chat/team-chat";
import { SavedMessages } from "./components/chat/saved-messages";
import {
	Calendar,
	HeartPulse,
	Kanban,
	LayoutDashboard,
	Route,
	Search,
	UserCheck,
	X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardView } from "./components/board-view";
import { HealthView } from "./components/health-view";
import { CalendarView } from "./components/calendar-view";
import { CardDetailSheet } from "./components/card-detail-sheet";
import { MyCardsView } from "./components/my-cards-view";
import { deriveProjectMetrics } from "./components/planner-model";
import { PlannerShell } from "./components/planner-shell";
import { ShortcutsDialog, useKeyboardShortcuts } from "./components/keyboard-shortcuts";
import { useTheme } from "./components/theme-provider";
import { useQueryState } from "nuqs";
import { parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs";
import type {
	PlannerCard,
	PlannerContext,
	PlannerIssue,
	PlannerSnapshot,
	PlannerView,
	ViewDefinition,
} from "./components/planner-types";
import type { SignalServerConfig } from "../ports/chat-signal";
import { ProjectOverview } from "./components/project-overview";
import { RoadmapView } from "./components/roadmap-view";
import "./styles/globals.css";

const GLOBAL_BOARD_STORAGE_KEY = "fizzyx.planner.selectedBoard";

const views: ViewDefinition[] = [
	{
		key: "overview",
		label: "Overview",
		description: "Executive project status",
		icon: <LayoutDashboard className="size-4" />,
	},
	{
		key: "my",
		label: "My Cards",
		description: "Assigned work",
		icon: <UserCheck className="size-4" />,
	},
	{
		key: "board",
		label: "Board",
		description: "Raw workflow lanes",
		icon: <Kanban className="size-4" />,
	},
	{
		key: "roadmap",
		label: "Roadmap",
		description: "Timeline and milestones",
		icon: <Route className="size-4" />,
	},
	{
		key: "calendar",
		label: "Calendar",
		description: "Dates and deadlines",
		icon: <Calendar className="size-4" />,
	},
	{
		key: "health",
		label: "Health",
		description: "Card metadata issues",
		icon: <HeartPulse className="size-4" />,
	},
];

type PlannerClientConfig = {
	readonly chat?: {
		readonly signalServer?: SignalServerConfig;
	};
};

export function App() {
	const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
	const [plannerContext, setPlannerContext] = useState<PlannerContext | null>(null);
	const [plannerConfig, setPlannerConfig] = useState<PlannerClientConfig>({});
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [chatOpen, setChatOpen] = useState(false);
	const [savedMessagesOpen, setSavedMessagesOpen] = useState(false);
	const [boardPickerOpen, setBoardPickerOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useQueryState("q", parseAsString.withDefault(""));
	const [selectedBoard, setSelectedBoard] = useQueryState("board", parseAsString);
	const [view, setView] = useQueryState(
		"view",
		parseAsStringEnum<PlannerView>([
			"overview",
			"my",
			"board",
			"roadmap",
			"calendar",
			"health",
		]).withDefault("overview"),
	);
	const [selectedCardNumber, setSelectedCardNumber] = useQueryState("card", parseAsInteger);
	const { toggleTheme } = useTheme();
	const searchInputRef = useRef<HTMLInputElement>(null);
	const normalizedSearchQuery = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery]);

	const buildSnapshotUrl = (fresh: boolean, boardId?: string | null): string => {
		const params = new URLSearchParams();
		if (fresh) params.set("fresh", "1");
		if (boardId) params.set("board", boardId);
		const suffix = params.toString();
		return suffix ? `/api/planner/snapshot?${suffix}` : "/api/planner/snapshot";
	};

	const loadSnapshot = async (fresh = false, boardId = selectedBoard) => {
		const shouldShowRefreshing = snapshot !== null;

		if (shouldShowRefreshing) {
			setIsRefreshing(true);
		} else {
			setIsLoading(true);
		}

		setError(null);
		try {
			const response = await fetch(buildSnapshotUrl(fresh, boardId));
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Failed to load planner snapshot");
			setSnapshot(data);
			if (!fresh && data.cache === "stale") {
				try {
					const freshResponse = await fetch(buildSnapshotUrl(true, boardId));
					const freshData = await freshResponse.json();
					if (freshResponse.ok) {
						setSnapshot(freshData);
					}
				} catch {
					// Keep the cached snapshot visible when the network is unavailable.
				}
			}
		} catch (cause) {
			if (!shouldShowRefreshing) {
				setError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			setIsRefreshing(false);
			setIsLoading(false);
		}
	};

	const loadPlannerConfig = async () => {
		try {
			const response = await fetch("/api/planner/config");
			const data = await response.json();
			if (response.ok) {
				setPlannerConfig(data);
			}
		} catch {
			// Team chat falls back to the public PeerJS signaling server.
		}
	};

	const loadPlannerContext = async () => {
		try {
			const response = await fetch("/api/planner/context");
			const data = (await response.json()) as PlannerContext | { error?: string };
			if (!response.ok) {
				throw new Error(
					"error" in data
						? data.error || "Failed to load planner context"
						: "Failed to load planner context",
				);
			}

			const context = data as PlannerContext;
			setPlannerContext(context);

			const storedBoard =
				typeof window === "undefined"
					? null
					: window.localStorage.getItem(GLOBAL_BOARD_STORAGE_KEY);
			const candidate =
				selectedBoard || context.defaultBoard || storedBoard || context.boards[0]?.id || null;
			const boardExists =
				candidate !== null && context.boards.some((board) => board.id === candidate);
			const nextBoard = boardExists ? candidate : (context.boards[0]?.id ?? null);
			if (!nextBoard) {
				throw new Error("No boards available for this account");
			}

			if (nextBoard !== selectedBoard) {
				void setSelectedBoard(nextBoard);
			}
			window.localStorage.setItem(GLOBAL_BOARD_STORAGE_KEY, nextBoard);
			await loadSnapshot(false, nextBoard);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadPlannerConfig();
		void loadPlannerContext();
	}, []);

	const handleBoardChange = (boardId: string) => {
		if (!boardId || boardId === selectedBoard) return;
		void setSelectedBoard(boardId);
		window.localStorage.setItem(GLOBAL_BOARD_STORAGE_KEY, boardId);
		void setSelectedCardNumber(null);
		setIsLoading(true);
		setSnapshot(null);
		void loadSnapshot(false, boardId);
	};

	const switchBoardByOffset = (offset: -1 | 1) => {
		const boards = plannerContext?.boards ?? [];
		if (boards.length < 2) return;

		const currentBoard = selectedBoard ?? snapshot?.board ?? boards[0]?.id;
		const currentIndex = boards.findIndex((board) => board.id === currentBoard);
		const startIndex = currentIndex >= 0 ? currentIndex : 0;
		const nextIndex = (startIndex + offset + boards.length) % boards.length;
		const nextBoard = boards[nextIndex];
		if (nextBoard) handleBoardChange(nextBoard.id);
	};

	const openBoardPicker = () => {
		if (!plannerContext || plannerContext.boards.length === 0) return;
		setBoardPickerOpen(true);
	};

	const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts(
		loadSnapshot,
		toggleTheme,
		() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		},
		() => setChatOpen((v) => !v),
		openBoardPicker,
		() => switchBoardByOffset(-1),
		() => switchBoardByOffset(1),
	);

	const selectedCard =
		selectedCardNumber === null
			? null
			: snapshot?.cards.find((card) => card.number === selectedCardNumber) || null;
	const selectCard = (card: PlannerCard) => void setSelectedCardNumber(card.number);
	const activeView = views.find((item) => item.key === view) || views[0]!;
	const searchableCards = useMemo(
		() =>
			snapshot === null
				? []
				: normalizedSearchQuery.length === 0
					? snapshot.cards
					: filterCardsBySearch(snapshot.cards, normalizedSearchQuery),
		[snapshot, normalizedSearchQuery],
	);
	const filteredHealth = useMemo(() => {
		if (!snapshot || normalizedSearchQuery.length === 0) return snapshot?.health ?? [];
		return snapshot.health.filter((item) => matchesIssue(item, normalizedSearchQuery));
	}, [snapshot, normalizedSearchQuery]);
	const filteredSnapshot = useMemo(() => {
		if (!snapshot) return null;
		return {
			...snapshot,
			cards: searchableCards,
		} satisfies PlannerSnapshot;
	}, [snapshot, searchableCards]);
	const searchResultCount =
		view === "health" ? filteredHealth.length : (filteredSnapshot?.cards.length ?? 0);
	const searchTotalCount =
		view === "health" ? (snapshot?.health.length ?? 0) : (snapshot?.summary.total ?? 0);

	const updateDeadline = async (cardNumber: number, deadline: string | null) => {
		try {
			const response = await fetch("/api/planner/update-deadline", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cardNumber, deadline: deadline ?? "", board: snapshot?.board }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Failed to update deadline");
			await loadSnapshot(true, snapshot?.board ?? selectedBoard);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	if (isLoading && !snapshot) {
		return (
			<div className="grid min-h-screen place-items-center bg-background p-8">
				<div className="max-w-sm text-center">
					<div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-muted">
						<div className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
					</div>
					<h1 className="mb-3 text-xl font-semibold tracking-tight">Loading planner</h1>
					<p className="text-sm leading-relaxed text-muted-foreground">
						Fetching your board data — this can take a moment.
						<br />
						Please don&apos;t close this page.
					</p>
				</div>
			</div>
		);
	}

	if (error) {
		const isWarning =
			error.includes("No .fizzy") || error.includes("No board") || error.includes("not configured");
		return (
			<div className="grid min-h-screen place-items-center bg-background p-8">
				<div className="max-w-sm text-center">
					<div className="mx-auto mb-5 grid size-14 place-items-center rounded-full bg-amber-500/10">
						<Kanban className="size-7 text-amber-500" />
					</div>
					<Badge
						variant={isWarning ? "secondary" : "destructive"}
						className="mb-4 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider"
					>
						{isWarning ? "Setup required" : "Error"}
					</Badge>
					<h1 className="mb-3 text-xl font-semibold tracking-tight">Planner unavailable</h1>
					<p className="mb-8 text-sm leading-relaxed text-muted-foreground">{error}</p>
					<Button
						variant="outline"
						size="sm"
						className="rounded-full px-6"
						onClick={() => void (plannerContext ? loadSnapshot() : loadPlannerContext())}
					>
						Retry
					</Button>
				</div>
			</div>
		);
	}

	return (
		<PlannerShell
			snapshot={snapshot}
			boards={plannerContext?.boards ?? []}
			selectedBoard={selectedBoard}
			loading={isLoading && snapshot === null}
			isRefreshing={isRefreshing}
			activeView={view}
			views={views}
			onViewChange={(next) => void setView(next)}
			onRefresh={loadSnapshot}
			onShowShortcuts={setShowShortcuts}
			boardPickerOpen={boardPickerOpen}
			onBoardPickerOpenChange={setBoardPickerOpen}
			onBoardChange={handleBoardChange}
			onToggleChat={() => setChatOpen((v) => !v)}
			chatOpen={chatOpen}
		>
			{snapshot ? (
				<PlannerHeader
					snapshot={snapshot}
					activeView={activeView}
					searchQuery={searchQuery}
					onSearchChange={(value) => {
						void setSearchQuery(value);
					}}
					searchInputRef={searchInputRef}
					resultCount={searchResultCount}
					totalCount={searchTotalCount}
				/>
			) : null}
			{snapshot ? (
				<PlannerViewRenderer
					snapshot={filteredSnapshot || snapshot}
					view={view}
					health={filteredHealth}
					onSelect={selectCard}
					onViewChange={(next) => void setView(next)}
					onRefreshFresh={() => loadSnapshot(true)}
				/>
			) : null}
			<CardDetailSheet
				card={selectedCard}
				onOpenChange={(open) => !open && void setSelectedCardNumber(null)}
				onSaveDeadline={async (deadline) => {
					if (selectedCard) {
						await updateDeadline(selectedCard.number, deadline);
					}
				}}
			/>
			<ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
			{snapshot &&
			chatOpen &&
			snapshot.identity &&
			snapshot.users.some((u) => u.id === snapshot.identity!.id) ? (
				<TeamChat
					open={chatOpen}
					account={snapshot.account}
					board={snapshot.board}
					identity={snapshot.identity}
					members={snapshot.users}
					signalServer={plannerConfig.chat?.signalServer}
					onClose={() => setChatOpen(false)}
					onOpenSavedMessages={() => {
						setChatOpen(false);
						setSavedMessagesOpen(true);
					}}
				/>
			) : null}
			{savedMessagesOpen && snapshot?.identity ? (
				<SavedMessages
					open={savedMessagesOpen}
					userId={snapshot.identity.id}
					userName={snapshot.identity.name}
					onClose={() => setSavedMessagesOpen(false)}
					onBackToChat={() => {
						setSavedMessagesOpen(false);
						setChatOpen(true);
					}}
				/>
			) : null}
		</PlannerShell>
	);
}

function PlannerViewRenderer({
	snapshot,
	view,
	health,
	onSelect,
	onViewChange,
	onRefreshFresh,
}: {
	snapshot: PlannerSnapshot;
	view: PlannerView;
	health: PlannerIssue[];
	onSelect: (card: PlannerCard) => void;
	onViewChange: (next: PlannerView) => void;
	onRefreshFresh: () => Promise<void>;
}) {
	const metrics = deriveProjectMetrics(snapshot);
	const navigateToMyCards = () => onViewChange("my");
	if (view === "roadmap") return <RoadmapView metrics={metrics} onSelect={onSelect} />;
	if (view === "calendar")
		return (
			<CalendarView
				cards={snapshot.cards}
				onSelect={onSelect}
				onNavigateToMyCards={navigateToMyCards}
			/>
		);
	if (view === "my") return <MyCardsView snapshot={snapshot} onSelect={onSelect} />;
	if (view === "board") return <BoardView cards={snapshot.cards} onSelect={onSelect} />;
	if (view === "health")
		return <HealthView health={health} onRepair={() => void onRefreshFresh()} />;
	return (
		<ProjectOverview
			snapshot={snapshot}
			metrics={metrics}
			onSelect={onSelect}
			onNavigateToMyCards={navigateToMyCards}
		/>
	);
}

function PlannerHeader({
	snapshot,
	activeView,
	searchQuery,
	onSearchChange,
	searchInputRef,
	resultCount,
	totalCount,
}: {
	snapshot: PlannerSnapshot;
	activeView: ViewDefinition;
	searchQuery: string;
	onSearchChange: (query: string) => void;
	searchInputRef: RefObject<HTMLInputElement | null>;
	resultCount: number;
	totalCount: number;
}) {
	return (
		<header className="mb-4 rounded-2xl bg-muted/35 px-4 py-3 sm:px-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<Badge className="rounded-full bg-primary/15 text-primary dark:text-primary">
							Planner
						</Badge>
					</div>
					<h1 className="text-3xl font-semibold tracking-tight">{activeView.label}</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						{activeView.description} for {snapshot.boardName}.
					</p>
				</div>
				<div className="rounded-full bg-background px-4 py-2 text-right text-sm">
					<p className="font-medium">{snapshot.summary.total} cards tracked</p>
					<p className="text-muted-foreground">
						Updated {new Date(snapshot.generatedAt).toLocaleString()}
					</p>
				</div>
			</div>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<div className="relative w-[min(100%,32rem)] min-w-[220px]">
					<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						ref={searchInputRef}
						value={searchQuery}
						onChange={(event) => onSearchChange(event.currentTarget.value)}
						placeholder="Search cards by title, #number, assignee, type, tags, owner"
						className="w-full rounded-full border-border/50 bg-background/85 py-5 pl-10 pr-10"
					/>
					{searchQuery ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onSearchChange("")}
							className="absolute right-2 top-1/2 h-6 -translate-y-1/2 rounded-full p-0 text-muted-foreground hover:text-foreground"
						>
							<X className="h-3.5 w-3.5" />
						</Button>
					) : null}
				</div>
				{searchQuery ? (
					<p className="text-xs text-muted-foreground">
						Showing {resultCount} of {totalCount} matches
					</p>
				) : null}
				{searchQuery && resultCount === 0 ? (
					<p className="text-xs text-amber-500">No matches. Try shorter keywords.</p>
				) : null}
			</div>
		</header>
	);
}

const filterCardsBySearch = (cards: PlannerCard[], query: string): PlannerCard[] => {
	if (!query) return cards;
	return cards.filter((card) => {
		if (String(card.number).includes(query) || `#${card.number}`.includes(query)) return true;
		if (card.title.toLowerCase().includes(query)) return true;
		if (card.lane.replace("_", " ").toLowerCase().includes(query)) return true;
		if (card.body.toLowerCase().includes(query)) return true;
		if (card.assignees.some((assignee) => assignee.name.toLowerCase().includes(query))) return true;
		if (card.parsedTags.area.some((tag) => tag.toLowerCase().includes(query))) return true;
		if (card.parsedTags.type.some((tag) => tag.toLowerCase().includes(query))) return true;
		if (card.parsedTags.phase.some((tag) => tag.toLowerCase().includes(query))) return true;
		if (card.parsedTags.priority.some((tag) => tag.toLowerCase().includes(query))) return true;
		const metadataValues = [
			card.metadata.priority,
			card.metadata.type,
			card.metadata.owner,
			card.metadata.deadline,
			card.metadata.impact,
			card.metadata.effort,
			card.metadata.phase,
		];
		for (const value of metadataValues) {
			if (value?.toLowerCase().includes(query)) return true;
		}
		return false;
	});
};

const matchesIssue = (issue: PlannerIssue, query: string): boolean => {
	return (
		issue.message.toLowerCase().includes(query) ||
		issue.title.toLowerCase().includes(query) ||
		issue.code.toLowerCase().includes(query) ||
		String(issue.cardNumber).includes(query)
	);
};

export default App;
