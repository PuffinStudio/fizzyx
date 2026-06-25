import { useEffect, useState } from "react";
import { parseAsInteger, parseAsStringEnum, useQueryState } from "nuqs";
import { LayoutDashboard, UserCheck, Kanban, Route, Calendar, HeartPulse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type {
	PlannerCard,
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
	const [view, setView] = useQueryState(
		"view",
		parseAsStringEnum<PlannerView>([
			"overview",
			"roadmap",
			"calendar",
			"my",
			"board",
			"health",
		]).withDefault("overview"),
	);
	const [selectedCardNumber, setSelectedCardNumber] = useQueryState("card", parseAsInteger);
	const { toggleTheme } = useTheme();

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

	const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts(loadSnapshot, toggleTheme);

	const selectedCard =
		selectedCardNumber === null
			? null
			: snapshot?.cards.find((card) => card.number === selectedCardNumber) || null;
	const selectCard = (card: PlannerCard) => void setSelectedCardNumber(card.number);
	const activeView = views.find((item) => item.key === view) || views[0]!;

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
			{snapshot ? <PlannerHeader snapshot={snapshot} activeView={activeView} /> : null}
			{error ? <ErrorCard error={error} /> : null}
			{snapshot ? (
				<PlannerViewRenderer
					snapshot={snapshot}
					view={view}
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
			/>
			<ShortcutsDialog open={showShortcuts} onOpenChange={setShowShortcuts} />
		</PlannerShell>
	);
}

function PlannerViewRenderer({
	snapshot,
	view,
	onSelect,
	onViewChange,
	onRefreshFresh,
}: {
	snapshot: PlannerSnapshot;
	view: PlannerView;
	onSelect: (card: PlannerCard) => void;
	onViewChange: (next: PlannerView) => void;
	onRefreshFresh: () => Promise<void>;
}) {
	const metrics = deriveProjectMetrics(snapshot);
	const navigateToMyCards = () => onViewChange("my");
	if (view === "roadmap") return <RoadmapView metrics={metrics} onSelect={onSelect} />;
	if (view === "calendar")
		return (
			<CalendarView metrics={metrics} onSelect={onSelect} onNavigateToMyCards={navigateToMyCards} />
		);
	if (view === "my") return <MyCardsView snapshot={snapshot} onSelect={onSelect} />;
	if (view === "board") return <BoardView cards={snapshot.cards} onSelect={onSelect} />;
	if (view === "health")
		return <HealthView health={snapshot.health} onRepair={() => void onRefreshFresh()} />;
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
}: {
	snapshot: PlannerSnapshot;
	activeView: ViewDefinition;
}) {
	return (
		<header className="mb-4 rounded-2xl bg-muted/35 px-4 py-3 sm:px-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<Badge className="rounded-full bg-primary/15 text-primary dark:text-primary">
							Fizzyx Planner
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

export default App;
