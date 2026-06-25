import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { PlannerUser } from "./planner-types";

export function UserAvatar({
	user,
	size = "md",
}: {
	user?: PlannerUser;
	size?: "sm" | "md" | "lg";
}) {
	const sizeClass = size === "lg" ? "size-11" : size === "sm" ? "size-6" : "size-8";
	return (
		<Avatar className={`${sizeClass} bg-background`} title={user?.name}>
			<AvatarImage src={avatarSrc(user?.avatarUrl)} alt={user?.name || "User"} />
			<AvatarFallback className="text-xs">{initials(user?.name)}</AvatarFallback>
		</Avatar>
	);
}

export function UserAvatarLabel({
	user,
	fallbackName = "Unknown user",
	size = "md",
	compact = false,
}: {
	user?: PlannerUser;
	fallbackName?: string;
	size?: "sm" | "md" | "lg";
	compact?: boolean;
}) {
	const name = user?.name || fallbackName;
	const displayUser = user ? { ...user, name } : { id: "unknown", name };
	if (compact) return <UserAvatar user={displayUser} size={size} />;

	return (
		<div
			className="flex min-w-0 items-center gap-2 rounded-full bg-muted/30 px-2 py-1 text-sm"
			title={name}
		>
			<UserAvatar user={displayUser} size={size} />
			<span className="truncate font-medium">{name}</span>
		</div>
	);
}

const avatarSrc = (value?: string): string =>
	value ? `/api/planner/avatar?url=${encodeURIComponent(value)}` : "";
const initials = (name?: string): string =>
	(name || "?")
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0]?.toUpperCase() || "")
		.join("");
