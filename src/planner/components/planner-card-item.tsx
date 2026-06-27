import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { getCardProgress } from "./planner-model";
import type { PlannerCard, SelectCard } from "./planner-types";
import { UserAvatarLabel } from "./user-avatar-label";
import { laneBadgeClass, priorityBadgeClass } from "./planner-style";

export function PlannerCardItem({
	card,
	compact,
	onSelect,
}: {
	card: PlannerCard;
	compact?: boolean;
	onSelect: SelectCard;
}) {
	const percent = getCardProgress(card);
	return (
		<button
			type="button"
			onClick={() => onSelect(card)}
			className="group/item w-full overflow-hidden rounded-lg bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<div className="flex min-w-0 items-start justify-between gap-2">
				<p className={`${compact ? "text-xs" : "text-sm"} min-w-0 font-medium leading-snug`}>
					#{card.number} {card.title}
				</p>
				<div className="flex shrink-0 items-center gap-1">
					<Badge className={`${laneBadgeClass(card.lane)} rounded-full`}>
						{card.lane.replace("_", " ")}
					</Badge>
					{card.parsedTags.priority[0] ? (
						<Badge className={`${priorityBadgeClass(card.parsedTags.priority[0])} rounded-full`}>
							{card.parsedTags.priority[0].toUpperCase()}
						</Badge>
					) : null}
				</div>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-1">
				{card.parsedTags.type[0] ? (
					<Badge variant="secondary" className="rounded-full">
						{card.parsedTags.type[0]}
					</Badge>
				) : (
					<Badge variant="outline" className="rounded-full text-muted-foreground">
						no type
					</Badge>
				)}
				{card.assignees.slice(0, 3).map((user) => (
					<UserAvatarLabel key={user.id} user={user} compact size="sm" />
				))}
			</div>
			<Progress className="mt-3" value={percent} />
		</button>
	);
}
