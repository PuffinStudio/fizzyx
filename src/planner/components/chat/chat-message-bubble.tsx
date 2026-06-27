import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import Markdown from "react-markdown";
import type { ChatMessage } from "../../../domain/chat";
import { cn } from "@/lib/utils";
import {
	Attachment,
	AttachmentContent,
	AttachmentDescription,
	AttachmentMedia,
	AttachmentTitle,
} from "../ui/attachment";
import { Marker, MarkerContent } from "../ui/marker";
import { Bubble, BubbleContent } from "../ui/bubble";
import {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
	MessageHeader,
} from "../ui/message";

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

const shortenReply = (text: string): string => {
	const cleaned = text.trim();
	if (cleaned.length <= 100) return cleaned;
	return `${cleaned.slice(0, 100)}…`;
};

export const ChatMessageBubble = ({
	message,
	isOwn,
	compact,
	onReplyClick,
}: ChatMessageBubbleProps) => {
	const timeStr = formatTime(message.createdAt);
	const isImageMessage = message.type === "image";
	const bubbleAlign = isOwn ? "end" : "start";
	const bubbleVariant = isOwn ? "default" : "muted";
	const showName = !isOwn && !compact;

	return (
		<Message align={bubbleAlign}>
			<MessageAvatar className={cn("size-8", compact ? "invisible" : "")}>
				{message.sender.avatarUrl ? (
					<img
						src={message.sender.avatarUrl}
						alt={message.sender.name}
						className="size-full object-cover"
					/>
				) : (
					<span
						className={cn(
							"grid size-full place-items-center text-[10px] font-medium text-white",
							avatarColor(message.sender.id),
						)}
					>
						{initials(message.sender.name)}
					</span>
				)}
			</MessageAvatar>
			<MessageContent>
				{showName ? <MessageHeader>{message.sender.name}</MessageHeader> : null}
				{message.replyTo ? (
					<button
						type="button"
						className="text-left"
						onClick={() => onReplyClick?.(message.replyTo!.id)}
					>
						<Marker variant="separator" className="px-1 text-[11px]">
							<MarkerContent className="font-semibold text-primary">
								Replying to {message.replyTo.sender.name}
							</MarkerContent>
							<MarkerContent className="text-muted-foreground">
								{shortenReply(message.replyTo.content)}
							</MarkerContent>
						</Marker>
					</button>
				) : null}

				<Bubble variant={bubbleVariant} align={bubbleAlign}>
					{isImageMessage ? (
						<Dialog>
							<DialogTrigger>
								<button type="button" className="text-left" aria-label="Open image preview">
									<Attachment size="sm" orientation="vertical">
										<AttachmentMedia variant="image">
											<img
												src={message.content}
												alt="Shared image"
												className="w-full rounded"
												loading="lazy"
											/>
										</AttachmentMedia>
										<AttachmentContent>
											<AttachmentTitle>Image attachment</AttachmentTitle>
											<AttachmentDescription>Click to view full size</AttachmentDescription>
										</AttachmentContent>
									</Attachment>
								</button>
							</DialogTrigger>
							<DialogContent className="w-max max-w-[92vw] border-0 bg-transparent p-0 shadow-none">
								<img
									src={message.content}
									alt="Shared image"
									className="max-h-[90vh] max-w-[90vw] rounded-2xl object-contain"
								/>
								<DialogClose />
							</DialogContent>
						</Dialog>
					) : (
						<BubbleContent className="min-w-0">
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
						</BubbleContent>
					)}
				</Bubble>

				<MessageFooter className="px-1 text-[10px] text-muted-foreground/50">
					{timeStr}
				</MessageFooter>
			</MessageContent>
		</Message>
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
