import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
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
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BoardView } from "./components/board-view";
import { HealthView } from "./components/health-view";
import { CalendarView } from "./components/calendar-view";
import { CardDetailSheet } from "./components/card-detail-sheet";
import { MyCardsView } from "./components/my-cards-view";
import { deriveProjectMetrics } from "./components/planner-model";
import { PlannerLoading } from "./components/planner-loading";
import { PlannerShell } from "./components/planner-shell";
import { ShortcutsDialog, useKeyboardShortcuts } from "./components/keyboard-shortcuts";
import { useTheme } from "./components/theme-provider";
import { useQueryState } from "nuqs";
import { parseAsInteger, parseAsString, parseAsStringEnum } from "nuqs";
import type {
	PlannerCard,
	PlannerIssue,
	PlannerSnapshot,
	PlannerView,
	ViewDefinition,
} from "./components/planner-types";
import { ProjectOverview } from "./components/project-overview";
import { RoadmapView } from "./components/roadmap-view";
import "./styles/globals.css";

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

export function App() {
	const [snapshot, setSnapshot] = useState<PlannerSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [searchQuery, setSearchQuery] = useQueryState("q", parseAsString.withDefault(""));
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

	const loadSnapshot = async (fresh = false) => {
		const shouldShowRefreshing = snapshot !== null;

		if (shouldShowRefreshing) {
			setIsRefreshing(true);
		} else {
			setIsLoading(true);
		}

		setError(null);
		try {
			const response = await fetch(
				fresh ? "/api/planner/snapshot?fresh=1" : "/api/planner/snapshot",
			);
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Failed to load planner snapshot");
			setSnapshot(data);
			if (!fresh && data.cache === "stale") {
				const freshResponse = await fetch("/api/planner/snapshot?fresh=1");
				const freshData = await freshResponse.json();
				if (!freshResponse.ok)
					throw new Error(freshData.error || "Failed to load planner snapshot");
				setSnapshot(freshData);
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setIsRefreshing(false);
			setIsLoading(false);
		}
	};

	useEffect(() => {
		void loadSnapshot();
	}, []);

	const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts(
		loadSnapshot,
		toggleTheme,
		() => {
			searchInputRef.current?.focus();
			searchInputRef.current?.select();
		},
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
				body: JSON.stringify({ cardNumber, deadline: deadline ?? "" }),
			});
			const data = await response.json();
			if (!response.ok) throw new Error(data.error || "Failed to update deadline");
			await loadSnapshot(true);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	};

	return (
		<PlannerShell
			snapshot={snapshot}
			loading={isLoading || isRefreshing}
			isRefreshing={isRefreshing}
			activeView={view}
			views={views}
			onViewChange={(next) => void setView(next)}
			onRefresh={loadSnapshot}
			onShowShortcuts={setShowShortcuts}
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
			{error ? <ErrorCard error={error} /> : null}
			{snapshot ? (
				<PlannerViewRenderer
					snapshot={filteredSnapshot || snapshot}
					view={view}
					health={filteredHealth}
					onSelect={selectCard}
					onViewChange={(next) => void setView(next)}
					onRefreshFresh={() => loadSnapshot(true)}
				/>
			) : (
				<PlannerLoading />
			)}
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
		return <CalendarView metrics={metrics} onSelect={onSelect} onNavigateToMyCards={navigateToMyCards} />;
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
							<Badge className="rounded-full" variant="outline">
							{snapshot.cache === "stale" ? "cached" : "live"}
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

function ErrorCard({ error }: { error: string }) {
	return (
		<Card className="mb-4 bg-destructive/5 shadow-none ring-0">
			<CardHeader>
				<CardTitle>Planner unavailable</CardTitle>
				<CardDescription>{error}</CardDescription>
			</CardHeader>
		</Card>
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
			card.metadata.api_status,
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
