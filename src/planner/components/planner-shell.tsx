import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronsUpDown, Clock, Kanban, Keyboard, MessageSquare, RefreshCw } from "lucide-react";
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
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import type { PlannerBoard, PlannerSnapshot, PlannerView, ViewDefinition } from "./planner-types";

export function PlannerShell({
	snapshot,
	boards,
	selectedBoard,
	loading,
	isRefreshing,
	activeView,
	views,
	onViewChange,
	onRefresh,
	onShowShortcuts,
	boardPickerOpen,
	onBoardPickerOpenChange,
	onBoardChange,
	onToggleChat,
	chatOpen,
	chatOnlineCount,
	children,
}: {
	snapshot: PlannerSnapshot | null;
	boards: PlannerBoard[];
	selectedBoard: string | null;
	loading: boolean;
	isRefreshing: boolean;
	activeView: PlannerView;
	views: ViewDefinition[];
	onViewChange: (view: PlannerView) => void;
	onRefresh: () => Promise<void>;
	onShowShortcuts: (show: boolean) => void;
	boardPickerOpen: boolean;
	onBoardPickerOpenChange: (open: boolean) => void;
	onBoardChange: (boardId: string) => void;
	onToggleChat?: () => void;
	chatOpen?: boolean;
	chatOnlineCount?: number;
	children: React.ReactNode;
}) {
	const selectedBoardValue = selectedBoard ?? snapshot?.board ?? "";
	const selectedBoardLabel =
		boards.find((board) => board.id === selectedBoardValue)?.name ||
		snapshot?.boardName ||
		selectedBoardValue ||
		"Board";
	const footerPillClass =
		"h-10 w-full rounded-full border border-sidebar-border/70 bg-background px-3 text-xs text-sidebar-foreground/75 flex items-center gap-2 transition-all hover:bg-sidebar-accent hover:text-sidebar-foreground";

	return (
		<SidebarProvider className="h-svh min-h-0 overflow-hidden">
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
								{boards.length > 0 ? (
									<Popover open={boardPickerOpen} onOpenChange={onBoardPickerOpenChange}>
										<PopoverTrigger
											render={
												<Button
													type="button"
													variant="ghost"
													size="sm"
													disabled={loading}
													className="min-w-0 flex-1 justify-between rounded-xl bg-sidebar-accent/45 px-2.5 text-sidebar-foreground hover:bg-sidebar-accent"
												/>
											}
											aria-label="Board"
										>
											<span className="min-w-0 flex-1 truncate text-left">
												{selectedBoardLabel}
											</span>
											<ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
										</PopoverTrigger>
										<PopoverContent
											align="start"
											sideOffset={6}
											className="w-64 overflow-hidden rounded-2xl p-0"
										>
											<Command
												filter={(value, search) =>
													value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
												}
											>
												<CommandInput placeholder="Search boards" />
												<CommandList>
													<CommandEmpty>No boards found</CommandEmpty>
													<CommandGroup>
														{boards.map((board) => (
															<CommandItem
																key={board.id}
																value={`${board.name || board.id} ${board.id}`}
																data-checked={board.id === selectedBoardValue}
																onSelect={() => {
																	onBoardChange(board.id);
																	onBoardPickerOpenChange(false);
																}}
															>
																<span className="truncate">{board.name || board.id}</span>
															</CommandItem>
														))}
													</CommandGroup>
												</CommandList>
											</Command>
										</PopoverContent>
									</Popover>
								) : (
									<p className="truncate text-sm text-sidebar-foreground">
										{snapshot?.boardName || snapshot?.board || "Board not loaded"}
									</p>
								)}
							</div>
						</div>
					</div>
				</SidebarHeader>
				<SidebarContent className="scroll-fade no-scrollbar overflow-auto">
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
								{onToggleChat ? (
									<button
										type="button"
										onClick={onToggleChat}
										className={`flex w-full items-center gap-2 rounded-full border px-3 py-2 text-left text-xs transition-all ${
											chatOpen
												? "border-primary/50 bg-primary/10 text-primary font-medium"
												: "border-transparent text-sidebar-foreground/60 hover:border-sidebar-border/70 hover:bg-sidebar-accent/35"
										}`}
									>
										<MessageSquare className="size-3.5" strokeWidth={2} />
										<span className="truncate">Team Chat</span>
										{chatOnlineCount !== undefined && chatOnlineCount > 0 ? (
											<Badge
												variant="default"
												className="ml-auto size-4.5 rounded-full p-0 text-[9px] leading-none grid place-items-center"
											>
												{chatOnlineCount}
											</Badge>
										) : null}
									</button>
								) : null}
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
			<SidebarInset className="h-svh min-w-0 min-h-0 flex-1 overflow-hidden">
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto scroll-fade no-scrollbar px-4 py-4 text-foreground lg:px-6">
					<div className="mb-4 flex items-center gap-2 md:hidden">
						<SidebarTrigger />
					</div>
					{children}
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
