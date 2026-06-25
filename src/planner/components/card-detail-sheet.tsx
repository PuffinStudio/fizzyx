import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
			<SheetContent className="w-[min(94vw,68rem)]! sm:max-w-none! gap-0 p-0">
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
								<section className="grid gap-3 md:grid-cols-4">
									<MetadataChip
										label="Owner"
										value={card.metadata.owner || card.assignees[0]?.name}
									/>
									<DeadlineChip
										label="Deadline"
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
									<MetadataChip label="API" value={card.metadata.api_status} />
								</section>
								<section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
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
									<DetailPanel title="Comments" action={`${card.comments.length} recent`}>
										{card.comments.length === 0 ? (
											<p className="text-sm text-muted-foreground">No comments.</p>
										) : null}
										{card.comments.map((comment) => (
											<CommentItem key={comment.id} comment={comment} />
										))}
									</DetailPanel>
								</section>
								<section className="grid gap-4 lg:grid-cols-[0.7fr_1.3fr]">
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
									<DetailPanel title="Description" action="body">
										<div className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
											{card.body || "No description body."}
										</div>
									</DetailPanel>
								</section>
							</div>
						</ScrollArea>
					</>
				) : null}
			</SheetContent>
		</Sheet>
	);
}

function DeadlineChip({
	label,
	value,
	onSave,
}: {
	label: string;
	value: string;
	onSave: (value: string) => Promise<void>;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(value);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!editing) {
			setDraft(value);
		}
	}, [editing, value]);

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			await onSave(draft.trim());
			setEditing(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Failed to save deadline");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="min-w-0 rounded-lg bg-muted/30 px-3 py-2">
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="truncate text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
					{label}
				</p>
				{editing ? null : (
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setEditing(true)}
						disabled={saving}
						className="h-7 rounded-full px-2 text-xs"
					>
						Edit
					</Button>
				)}
			</div>
			{editing ? (
				<div className="space-y-2">
					<Input
						type="date"
						value={draft}
						onChange={(event) => setDraft(event.currentTarget.value)}
						disabled={saving}
					/>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							onClick={() => void save()}
							disabled={saving}
							className="rounded-full"
						>
							Save
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setDraft("");
								void save();
							}}
							disabled={saving}
							className="rounded-full"
						>
							Clear
						</Button>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setEditing(false)}
							disabled={saving}
							className="rounded-full"
						>
							Cancel
						</Button>
					</div>
					{error ? <p className="text-xs text-destructive">{error}</p> : null}
				</div>
			) : (
				<p className="truncate text-sm font-medium">{value || "—"}</p>
			)}
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
