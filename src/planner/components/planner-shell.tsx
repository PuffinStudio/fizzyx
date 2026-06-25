import { Button } from "@/components/ui/button";
import { Clock, Kanban, Keyboard, RefreshCw } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarInset,
	SidebarProvider,
	SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserAvatar, UserAvatarLabel } from "./user-avatar-label";
import type { PlannerSnapshot, PlannerView, ViewDefinition } from "./planner-types";

export function PlannerShell({
	snapshot,
	loading,
	isRefreshing,
	activeView,
	views,
	onViewChange,
	onRefresh,
	onShowShortcuts,
	children,
}: {
	snapshot: PlannerSnapshot | null;
	loading: boolean;
	isRefreshing: boolean;
	activeView: PlannerView;
	views: ViewDefinition[];
	onViewChange: (view: PlannerView) => void;
	onRefresh: () => Promise<void>;
	onShowShortcuts: (show: boolean) => void;
	children: React.ReactNode;
}) {
	const footerPillClass =
		"h-10 w-full rounded-full border border-sidebar-border/70 bg-background px-3 text-xs text-sidebar-foreground/75 flex items-center gap-2 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground";

	return (
		<SidebarProvider>
			<Sidebar
				variant="sidebar"
				collapsible="offcanvas"
				className="bg-background border-r border-sidebar-border/70 shadow-sm"
			>
				<SidebarHeader className="p-3">
					<div className="space-y-2.5">
						<div className="rounded-2xl border border-sidebar-border/10 bg-background px-3 py-2">
							<div className="flex min-w-0 items-center gap-2">
								<UserAvatar user={snapshot?.identity} size="md" />
								<p className="truncate text-sm font-medium text-sidebar-foreground">
									{snapshot?.identity?.name || "Current user"}
								</p>
							</div>
							<div className="mt-2 flex min-w-0 items-center gap-2">
								<Kanban className="size-4 text-sidebar-foreground/80" />
								<p className="truncate text-sm text-sidebar-foreground">
									{snapshot?.boardName || snapshot?.board || "Board not loaded"}
								</p>
							</div>
						</div>
					</div>
				</SidebarHeader>
				<SidebarContent className="overflow-auto">
					<SidebarGroup>
						<SidebarGroupLabel className="rounded-md">Workspace</SidebarGroupLabel>
						<SidebarGroupContent className="space-y-1 px-2">
							{views.map((view) => (
								<button
									key={view.key}
									type="button"
									onClick={() => onViewChange(view.key)}
									className={`flex w-full items-center gap-2 rounded-full border border-transparent px-3 py-2.5 text-left text-sm transition-all ${
										activeView === view.key
											? "border-primary bg-sidebar-accent/55 text-primary font-semibold"
											: "hover:border-sidebar-border/70 hover:bg-sidebar-accent/35"
									}`}
								>
									<span className="grid size-5 place-items-center">{view.icon}</span>
									<span className="truncate">{view.label}</span>
								</button>
							))}
						</SidebarGroupContent>
					</SidebarGroup>
					{snapshot?.users && snapshot.users.length > 1 ? (
						<SidebarGroup>
							<SidebarGroupLabel className="rounded-md">Team</SidebarGroupLabel>
							<SidebarGroupContent className="space-y-1 px-2">
								<div className="space-y-1">
									{snapshot.users.slice(0, 8).map((user) => (
										<UserAvatarLabel key={user.id} user={user} />
									))}
								</div>
							</SidebarGroupContent>
						</SidebarGroup>
					) : null}
				</SidebarContent>
				<SidebarFooter className="flex flex-col gap-2 p-3">
					<Button
						variant="ghost"
						size="sm"
						className={footerPillClass}
						onClick={() => void onRefresh()}
						disabled={loading}
					>
						<RefreshCw
							className={`size-4 transition-transform ${isRefreshing ? "animate-spin" : ""}`}
							strokeWidth={2}
						/>
						{isRefreshing ? "Refreshing…" : "Refresh board"}
					</Button>
					<div role="status" aria-live="polite" className={footerPillClass}>
						<Clock className="size-4 text-sidebar-foreground/60" strokeWidth={2} />
						{snapshot
							? `Updated ${new Date(snapshot.generatedAt).toLocaleString()}`
							: "Live from Fizzy API"}
					</div>
					<Button
						variant="ghost"
						size="sm"
						className={footerPillClass}
						onClick={() => onShowShortcuts(true)}
					>
						<Keyboard className="size-4" strokeWidth={2} />
						<span>Keyboard Shortcuts</span>
					</Button>
				</SidebarFooter>
			</Sidebar>
			<SidebarInset className="min-w-0">
				<div className="min-w-0 min-h-screen bg-background px-4 py-4 text-foreground lg:px-6">
					<div className="mb-4 flex items-center gap-2 md:hidden">
						<SidebarTrigger />
					</div>
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
