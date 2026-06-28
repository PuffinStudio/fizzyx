import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import type { PlannerCard } from "./planner-types";
import { getCardProgress } from "./planner-model";
import { laneBadgeClass, priorityBadgeClass } from "./planner-style";
import { UserAvatarLabel } from "./user-avatar-label";

export function CardDetailSheet({
	card,
	onOpenChange,
	onSaveDeadline,
}: {
	card: PlannerCard | null;
	onOpenChange: (open: boolean) => void;
	onSaveDeadline: (deadline: string) => Promise<void>;
}) {
	const progress = card ? getCardProgress(card) : 0;
	const toDateInputValue = (value?: string): string => {
		if (!value) return "";
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return value;
		return date.toISOString().slice(0, 10);
	};

	return (
		<Sheet open={card !== null} onOpenChange={onOpenChange}>
			<SheetContent className="w-[min(100vw,80rem)]! sm:max-w-none! gap-0 p-0">
				{card ? (
					<>
						<SheetHeader className="p-5">
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div className="min-w-0 flex-1">
									<div className="mb-2 flex flex-wrap gap-2">
										<Badge variant="outline" className="rounded-full">
											#{card.number}
										</Badge>
										<Badge className={`${laneBadgeClass(card.lane)} rounded-full`}>
											{card.lane.replace("_", " ")}
										</Badge>
										{card.parsedTags.priority[0] ? (
											<Badge
												className={`${priorityBadgeClass(card.parsedTags.priority[0])} rounded-full`}
											>
												{card.parsedTags.priority[0].toUpperCase()}
											</Badge>
										) : null}
										{card.metadata.type || card.parsedTags.type[0] ? (
											<Badge variant="secondary" className="rounded-full">
												{card.metadata.type || card.parsedTags.type[0]}
											</Badge>
										) : null}
									</div>
									<SheetTitle className="text-2xl leading-tight">{card.title}</SheetTitle>
									<SheetDescription className="mt-2">
										Execution context from Fizzy: owner, progress, steps, comments, and metadata.
									</SheetDescription>
								</div>
								<div className="w-full rounded-xl bg-muted/35 p-3 sm:w-52">
									<div className="mb-2 flex items-center justify-between text-sm">
										<span className="text-muted-foreground">Progress</span>
										<span className="font-medium">{progress}%</span>
									</div>
									<Progress value={progress} />
								</div>
							</div>
						</SheetHeader>
						<ScrollArea className="h-[calc(100vh-9rem)]">
							<div className="space-y-4 p-5">
								<section className="grid grid-cols-4 gap-3 lg:grid-cols-8">
									<MetadataChip
										label="Owner"
										value={card.metadata.owner || card.assignees[0]?.name}
									/>
									<DeadlineChip
										value={toDateInputValue(card.metadata.deadline)}
										onSave={(deadline) => onSaveDeadline(deadline || "")}
									/>
									<MetadataChip label="Impact" value={card.metadata.impact} />
									<MetadataChip label="Effort" value={card.metadata.effort} />
									<MetadataChip
										label="Priority"
										value={card.metadata.priority || card.parsedTags.priority[0]}
									/>
									<MetadataChip
										label="Type"
										value={card.metadata.type || card.parsedTags.type[0]}
									/>
									<MetadataChip
										label="Phase"
										value={card.metadata.phase || card.parsedTags.phase[0]}
									/>
								</section>
								<section className="grid gap-4 lg:grid-cols-2">
									<DetailPanel
										title="Steps"
										action={`${card.stepProgress.completed}/${card.stepProgress.total}`}
									>
										{card.steps.length === 0 ? (
											<p className="text-sm text-muted-foreground">No steps.</p>
										) : null}
										{card.steps.map((step, index) => (
											<StepItem key={step.id || index} step={step} />
										))}
									</DetailPanel>
									<DetailPanel title="People" action={`${card.assignees.length} assigned`}>
										<div className="flex flex-wrap gap-2">
											{card.assignees.length === 0 ? (
												<Badge variant="outline" className="rounded-full">
													No assignee
												</Badge>
											) : null}
											{card.assignees.map((user) => (
												<UserAvatarLabel key={user.id} user={user} size="sm" />
											))}
										</div>
										<div className="mt-3 grid grid-cols-2 gap-2">
											<MetadataChip
												label="Depends on"
												value={
													card.metadata.depends_on.length
														? card.metadata.depends_on.map((item) => `#${item}`).join(", ")
														: undefined
												}
											/>
											<MetadataChip
												label="Blocks"
												value={
													card.metadata.blocks.length
														? card.metadata.blocks.map((item) => `#${item}`).join(", ")
														: undefined
												}
											/>
										</div>
									</DetailPanel>
								</section>
								<DetailPanel title="Description">
									{card.body?.trim() ? (
										<div
											className="[&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_p]:text-sm [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-sm [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:text-sm [&_li]:mt-1 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_hr]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:text-sm [&_blockquote]:text-muted-foreground [&_img]:rounded-lg [&_img]:max-w-full [&_table]:w-full [&_table]:text-sm [&_th]:text-left [&_th]:font-medium [&_th]:pb-1 [&_td]:py-0.5"
											dangerouslySetInnerHTML={{ __html: card.body }}
										/>
									) : (
										<p className="text-sm text-muted-foreground">No description body.</p>
									)}
								</DetailPanel>
								<DetailPanel title="Comments" action={`${card.comments.length} total`}>
									{card.comments.length === 0 ? (
										<p className="text-sm text-muted-foreground">No comments.</p>
									) : null}
									{card.comments.map((comment) => (
										<CommentItem key={comment.id} comment={comment} />
									))}
								</DetailPanel>
							</div>
						</ScrollArea>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function DeadlineChip({
	value,
	onSave,
}: {
	value: string;
	onSave: (value: string) => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const date = value
		? (() => {
				const parts = value.split("-");
				return new Date(Number(parts[0]!), Number(parts[1]!) - 1, Number(parts[2]!));
			})()
		: undefined;

	const formatDate = (d: Date) =>
		d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

	const toIso = (d: Date) =>
		`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

	const save = async (d: Date | undefined) => {
		setOpen(false);
		setError(null);
		try {
			const iso = d ? toIso(d) : "";
			await onSave(iso);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Failed to save deadline");
		}
	};

	return (
		<div className="min-w-0 rounded-lg bg-muted/30 px-3 py-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={
						<Button
							variant="outline"
							size="sm"
							className="w-full justify-start gap-2 rounded-full"
						/>
					}
				>
					<CalendarDays className="size-3.5 shrink-0" />
					{date ? (
						<span className="text-sm font-medium">{formatDate(date)}</span>
					) : (
						<span className="text-sm text-muted-foreground">Set deadline</span>
					)}
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar mode="single" selected={date} onSelect={(d) => void save(d)} />
					{date ? (
						<div className="border-t border-border px-3 pb-3 pt-2">
							<Button
								variant="ghost"
								size="sm"
								className="w-full rounded-full text-xs text-destructive"
								onClick={() => void save(undefined)}
							>
								Clear deadline
							</Button>
						</div>
					) : null}
					{error ? <p className="px-3 pb-3 text-xs text-destructive">{error}</p> : null}
				</PopoverContent>
			</Popover>
		</div>
	);
}

function DetailPanel({
	title,
	action,
	children,
}: {
	title: string;
	action?: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl bg-muted/20 p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<p className="font-medium">{title}</p>
				{action ? (
					<Badge variant="secondary" className="rounded-full">
						{action}
					</Badge>
				) : null}
			</div>
			<div className="space-y-2">{children}</div>
		</section>
	);
}

function StepItem({ step }: { step: PlannerCard["steps"][number] }) {
	return (
		<div className="flex items-start gap-3 rounded-lg bg-muted/30 p-3">
			<span
				className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-xs ${step.completed ? "bg-emerald-500 text-white" : "border border-muted-foreground/40"}`}
			>
				{step.completed ? "✓" : ""}
			</span>
			<span className={step.completed ? "text-sm text-muted-foreground line-through" : "text-sm"}>
				{step.content}
			</span>
		</div>
	);
}

function CommentItem({ comment }: { comment: PlannerCard["comments"][number] }) {
	return (
		<article className="rounded-lg bg-muted/30 p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<UserAvatarLabel user={comment.creator} size="sm" />
				<time className="shrink-0 text-xs text-muted-foreground">
					{new Date(comment.createdAt).toLocaleDateString(undefined, {
						month: "short",
						day: "numeric",
					})}
				</time>
			</div>
			<p className="whitespace-pre-wrap text-sm text-muted-foreground">
				{comment.body || "(no content)"}
			</p>
		</article>
	);
}

function MetadataChip({ label, value }: { label: string; value?: string }) {
	return (
		<div className="min-w-0 rounded-lg bg-muted/30 px-3 py-2">
			<p className="truncate text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
				{label}
			</p>
			<p className="mt-0.5 truncate text-sm font-medium">{value || "—"}</p>
		</div>
	);
}
