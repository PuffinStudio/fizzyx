import type { ChatMessage } from "../../../domain/chat";
import { cn } from "@/lib/utils";
import Markdown from "react-markdown";
import { Dialog, DialogTrigger, DialogContent, DialogClose } from "@/components/ui/dialog";

export interface ChatMessageBubbleProps {
	readonly message: ChatMessage;
	readonly isOwn: boolean;
	readonly compact?: boolean;
	readonly onReplyClick?: (targetId: string) => void;
}

const avatarColor = (name: string): string => {
	const colors = [
		"bg-red-500",
		"bg-orange-500",
		"bg-amber-500",
		"bg-yellow-500",
		"bg-lime-500",
		"bg-green-500",
		"bg-emerald-500",
		"bg-teal-500",
		"bg-cyan-500",
		"bg-sky-500",
		"bg-blue-500",
		"bg-indigo-500",
		"bg-violet-500",
		"bg-purple-500",
		"bg-fuchsia-500",
		"bg-pink-500",
	];
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
	return colors[Math.abs(hash) % colors.length]!;
};

const initials = (name: string): string =>
	name
		.split(/\s+/)
		.map((s) => s[0])
		.join("")
		.toUpperCase()
		.slice(0, 2) || "?";

export const ChatMessageBubble = ({
	message,
	isOwn,
	compact,
	onReplyClick,
}: ChatMessageBubbleProps) => {
	const timeStr = formatTime(message.createdAt);

	return (
		<div className={cn("flex gap-2", isOwn ? "flex-row-reverse" : "flex-row")}>
			{compact ? (
				<div className="mt-1 size-6 shrink-0" />
			) : message.sender.avatarUrl ? (
				<img
					src={message.sender.avatarUrl}
					alt={message.sender.name}
					className="mt-1 size-6 shrink-0 rounded-full object-cover"
				/>
			) : (
				<div
					className={cn(
						"mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white",
						avatarColor(message.sender.id),
					)}
				>
					{initials(message.sender.name)}
				</div>
			)}
			<div className={cn("flex max-w-[80%] flex-col", isOwn ? "items-end" : "items-start")}>
				{!isOwn && !compact ? (
					<span className="mb-0.5 px-1 text-[10px] text-muted-foreground/70 font-medium">
						{message.sender.name}
					</span>
				) : null}
				{message.replyTo ? (
					<div
						className="mb-0.5 flex cursor-pointer items-stretch gap-2 px-2"
						onClick={(e) => {
							e.stopPropagation();
							onReplyClick?.(message.replyTo!.id);
						}}
					>
						<div className="w-[3px] shrink-0 rounded-full bg-primary" />
						<div className="min-w-0 flex-1">
							<span className="text-[11px] font-semibold text-primary">
								Replying to {message.replyTo.sender.name}
							</span>
							<p className="line-clamp-1 text-xs text-muted-foreground/60">
								{message.replyTo.content}
							</p>
						</div>
					</div>
				) : null}
				{message.type === "image" ? (
					<Dialog>
						<DialogTrigger className="block cursor-pointer overflow-hidden rounded-2xl border border-sidebar-border/40">
							<img
								src={message.content}
								alt="Shared image"
								className="max-h-64 max-w-full object-contain"
								loading="lazy"
							/>
						</DialogTrigger>
						<DialogContent className="w-max max-w-[90vw] border-0 bg-transparent p-0 shadow-none">
							<img
								src={message.content}
								alt="Shared image"
								className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain"
							/>
							<DialogClose />
						</DialogContent>
					</Dialog>
				) : (
					<div
						className={cn(
							"rounded-2xl px-3 py-1.5 text-sm leading-relaxed",
							isOwn
								? "bg-primary text-primary-foreground rounded-br-md"
								: "bg-muted text-foreground rounded-bl-md",
						)}
					>
						<div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
							<Markdown
								components={{
									a: ({ href, children }) => (
										<a
											href={href}
											target="_blank"
											rel="noopener noreferrer"
											className="underline underline-offset-2 decoration-1"
										>
											{children}
										</a>
									),
									code: ({ className, children, ...props }) => {
										const isInline = !className;
										if (isInline) {
											return (
												<code
													className="rounded bg-black/10 px-1 py-0.5 text-[13px] dark:bg-white/10"
													{...props}
												>
													{children}
												</code>
											);
										}
										return (
											<pre className="overflow-x-auto rounded-lg bg-black/10 p-2 text-[13px] dark:bg-white/10">
												<code className={className} {...props}>
													{children}
												</code>
											</pre>
										);
									},
									img: ({ src, alt }) => (
										<img
											src={src}
											alt={alt ?? ""}
											className="max-w-full rounded-lg"
											loading="lazy"
										/>
									),
								}}
							>
								{message.content}
							</Markdown>
						</div>
					</div>
				)}
				<span className="px-1 text-[10px] text-muted-foreground/50">{timeStr}</span>
			</div>
		</div>
	);
};

const formatTime = (iso: string): string => {
	const d = new Date(iso);
	const now = new Date();
	const sameDay =
		d.getFullYear() === now.getFullYear() &&
		d.getMonth() === now.getMonth() &&
		d.getDate() === now.getDate();

	if (sameDay) {
		return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	}

	return d.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
};
