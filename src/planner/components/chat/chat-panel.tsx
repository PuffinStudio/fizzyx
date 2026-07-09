import { useRef, useEffect, useState, useCallback, type ClipboardEvent } from "react";
import { cn } from "@/lib/utils";
import {
	Bookmark,
	MessageSquare,
	Send,
	Paperclip,
	Users,
	X,
	Maximize2,
	Minimize2,
	Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuTrigger,
	ContextMenuContent,
	ContextMenuItem,
} from "@/components/ui/context-menu";
import { ChatMessageBubble } from "./chat-message-bubble";
import { useChatContext } from "./chat-provider";
import { IndexedDBChatStorage } from "../../../adapters/chat-indexeddb";
import type { MessageReplyRef } from "../../../domain/chat";
import {
	MessageScroller,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "../ui/message-scroller";

const panelStore = new IndexedDBChatStorage();
const PANEL_KEY = "chat-panel-state";

interface PanelState {
	offset: { x: number; y: number };
	size: { w: number; h: number };
	maximized: boolean;
}

let cachedState: PanelState | null = null;

type ChatView = "team" | "self";

export interface ChatPanelProps {
	readonly onClose: () => void;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const ChatPanel = ({ onClose: _onClose }: ChatPanelProps) => {
	const {
		currentUserId,
		messages,
		selfMessages,
		connectedPeers,
		connectionState,
		sendText,
		sendSelfText,
		sendImage,
		sendSelfImage,
		connect,
		loadHistory,
		loadSelfHistory,
	} = useChatContext();

	const [view, setView] = useState<ChatView>("team");
	const displayMessages = view === "self" ? selfMessages : messages;
	const [text, setText] = useState("");
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [sending, setSending] = useState(false);
	const messageViewportRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const pastedFileRef = useRef<File | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const messageRefs = useRef(new Map<string, HTMLDivElement>());
	const [mounted, setMounted] = useState(false);
	const [maximized, setMaximized] = useState(() => cachedState?.maximized ?? false);
	const [offset, setOffset] = useState(() => cachedState?.offset ?? { x: 0, y: 0 });
	const [size, setSize] = useState(() => cachedState?.size ?? { w: 504, h: 540 });
	const [replyingTo, setReplyingTo] = useState<MessageReplyRef | null>(null);
	const panelState = useRef({
		offset: cachedState?.offset ?? { x: 0, y: 0 },
		size: cachedState?.size ?? { w: 504, h: 540 },
		maximized: cachedState?.maximized ?? false,
	});

	useEffect(() => {
		requestAnimationFrame(() => setMounted(true));
	}, []);

	useEffect(() => {
		if (cachedState) return;
		void panelStore.getMeta<PanelState>(PANEL_KEY).then((saved) => {
			if (!saved) return;
			cachedState = saved;
			panelState.current = saved;
			setOffset(saved.offset);
			setSize(saved.size);
			setMaximized(saved.maximized);
		});
	}, []);

	useEffect(() => {
		panelState.current = { offset, size, maximized };
	}, [offset, size, maximized]);

	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		const frame = requestAnimationFrame(() => {
			el.style.height = "0px";
			el.style.height = `${el.scrollHeight}px`;
		});
		return () => cancelAnimationFrame(frame);
	}, [text]);

	const saveState = () => {
		const s = panelState.current;
		cachedState = s;
		void panelStore.setMeta(PANEL_KEY, s);
	};

	useEffect(() => {
		if (!mounted) return;
		saveState();
	}, [maximized]);

	const scrollToBottom = useCallback(() => {
		const viewport = messageViewportRef.current;
		if (!viewport) return;
		requestAnimationFrame(() => {
			viewport.scrollTop = viewport.scrollHeight;
		});
	}, []);

	useEffect(() => {
		scrollToBottom();
	}, [displayMessages, scrollToBottom]);

	useEffect(() => {
		if (connectionState === "connected") {
			if (view === "team" && displayMessages.length === 0) {
				void loadHistory().then(() => scrollToBottom());
			} else if (view === "self" && displayMessages.length === 0) {
				void loadSelfHistory().then(() => scrollToBottom());
			}
		}
	}, [connectionState, view]);

	const handleSend = async () => {
		if (sending || (!text.trim() && !imagePreview)) return;
		setSending(true);
		try {
			const file = pastedFileRef.current ?? fileInputRef.current?.files?.[0];
			if (imagePreview && file) {
				if (view === "self") {
					await sendSelfImage(file);
				} else {
					await sendImage(file);
				}
				setImagePreview(null);
				pastedFileRef.current = null;
				if (fileInputRef.current) fileInputRef.current.value = "";
			}
			if (text.trim()) {
				if (view === "self") {
					await sendSelfText(text);
				} else {
					await sendText(text, replyingTo ?? undefined);
				}
				setText("");
				setReplyingTo(null);
			}
		} finally {
			setSending(false);
			inputRef.current?.focus();
			scrollToBottom();
		}
	};

	const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const items = e.clipboardData.items;
		for (const item of items) {
			if (item.type.startsWith("image/")) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file) continue;
				const reader = new FileReader();
				reader.onload = () => setImagePreview(reader.result as string);
				reader.readAsDataURL(file);
				pastedFileRef.current = file;
				return;
			}
		}
	};

	const dragState = useRef({
		dragging: false,
		startX: 0,
		startY: 0,
		dx: 0,
		dy: 0,
	});

	const handleHeaderPointerDown = useCallback((e: React.PointerEvent) => {
		if ((e.target as HTMLElement).closest("button")) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		const s = dragState.current;
		s.startX = e.clientX - s.dx;
		s.startY = e.clientY - s.dy;
		s.dragging = true;
	}, []);

	const handleHeaderPointerMove = useCallback((e: React.PointerEvent) => {
		const s = dragState.current;
		if (!s.dragging) return;
		s.dx = e.clientX - s.startX;
		s.dy = e.clientY - s.startY;
		setOffset({ x: s.dx, y: s.dy });
	}, []);

	const handleHeaderPointerEnd = useCallback(
		(e: React.PointerEvent) => {
			e.currentTarget.releasePointerCapture(e.pointerId);
			dragState.current.dragging = false;
			saveState();
		},
		[saveState],
	);

	const resizeState = useRef({
		resizing: false,
		startX: 0,
		startY: 0,
		w: 0,
		h: 0,
	});

	const handleResizePointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			e.currentTarget.setPointerCapture(e.pointerId);
			const s = resizeState.current;
			s.startX = e.clientX;
			s.startY = e.clientY;
			s.w = size.w;
			s.h = size.h;
			s.resizing = true;
		},
		[size],
	);

	const handleResizePointerMove = useCallback((e: React.PointerEvent) => {
		const s = resizeState.current;
		if (!s.resizing) return;
		const dx = e.clientX - s.startX;
		const dy = e.clientY - s.startY;
		setSize({
			w: clamp(s.w + dx, 320, 800),
			h: clamp(s.h + dy, 400, 900),
		});
	}, []);

	const handleResizePointerEnd = useCallback((e: React.PointerEvent) => {
		e.currentTarget.releasePointerCapture(e.pointerId);
		resizeState.current.resizing = false;
		saveState();
	}, []);

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => setImagePreview(reader.result as string);
		reader.readAsDataURL(file);
	};

	const scrollToMessage = useCallback((targetId: string) => {
		const el = messageRefs.current.get(targetId);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}, []);

	return (
		<div
			ref={panelRef}
			className="fixed bottom-4 right-4 z-50 flex select-none flex-col rounded-2xl border border-sidebar-border/70 bg-background/95 shadow-xl backdrop-blur-xl transition-[height,width,inset,opacity,transform] duration-300 ease-out"
			style={{
				width: maximized ? "30vw" : size.w,
				height: maximized ? "calc(100vh - 32px)" : size.h,
				opacity: mounted ? 1 : 0,
				transform: `translate(${offset.x}px, ${maximized ? 0 : offset.y}px)${mounted ? "" : " translateY(8px)"}`,
				right: maximized ? "16px" : undefined,
				top: maximized ? "16px" : undefined,
				bottom: maximized ? "16px" : undefined,
				touchAction: "none",
			}}
		>
			<div
				className="flex cursor-grab items-center justify-between rounded-t-2xl border-b border-sidebar-border/20 px-3 py-2.5 active:cursor-grabbing"
				onPointerDown={handleHeaderPointerDown}
				onPointerMove={handleHeaderPointerMove}
				onPointerUp={handleHeaderPointerEnd}
				onPointerCancel={handleHeaderPointerEnd}
			>
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => setView("team")}
						className={cn(
							"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all",
							view === "team"
								? "bg-primary/10 text-primary font-medium"
								: "text-muted-foreground/50 hover:text-foreground",
						)}
					>
						<MessageSquare className="size-3.5" />
						<span>Chat</span>
					</button>
					<button
						type="button"
						onClick={() => setView("self")}
						className={cn(
							"flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-all",
							view === "self"
								? "bg-primary/10 text-primary font-medium"
								: "text-muted-foreground/50 hover:text-foreground",
						)}
					>
						<Bookmark className="size-3.5" />
						<span>Saved</span>
					</button>
					<div
						className={cn(
							"size-1.5 rounded-full ml-1",
							connectionState === "connected" ? "bg-green-500" : "bg-muted-foreground/30",
						)}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="size-7 rounded-full p-0"
					onClick={() =>
						setMaximized((m) => {
							if (!m) {
								dragState.current.dx = 0;
								dragState.current.dy = 0;
								setOffset({ x: 0, y: 0 });
							}
							return !m;
						})
					}
				>
					{maximized ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
				</Button>
			</div>

			{connectionState === "disconnected" && view === "team" ? (
				<div className="flex flex-col items-center gap-3 px-4 py-12">
					<Users className="size-10 text-muted-foreground/30" />
					<div className="text-center">
						<p className="text-sm font-medium text-foreground/80">Chat</p>
						<p className="text-xs text-muted-foreground/60 mt-0.5">
							End-to-end encrypted. Only board members can join.
						</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						className="rounded-full"
						onClick={() => void connect()}
					>
						Connect
					</Button>
				</div>
			) : connectionState === "connecting" ? (
				<div className="flex flex-col items-center justify-center gap-2 px-4 py-12">
					<Loader2 className="size-5 animate-spin text-muted-foreground/40" />
				</div>
			) : connectionState === "error" ? (
				<div className="flex flex-col items-center gap-3 px-4 py-12">
					<p className="text-xs text-muted-foreground/60 text-center">
						Couldn't connect to signaling server. <br />
						Check your network and try again.
					</p>
					<Button
						size="sm"
						variant="outline"
						className="rounded-full"
						onClick={() => void connect()}
					>
						Retry
					</Button>
				</div>
			) : (
				<>
					{view === "team" ? (
						<div className="flex items-center gap-2 border-b border-sidebar-border/20 px-4 py-1.5">
							<Users className="size-3 text-muted-foreground/50" />
							<span className="text-[10px] text-muted-foreground/50">
								{connectedPeers.length > 0
									? connectedPeers.map((p) => p.name).join(", ")
									: "No one else online"}
							</span>
						</div>
					) : null}

					<MessageScrollerProvider>
						<MessageScroller className="min-h-0 flex-1">
							<MessageScrollerViewport ref={messageViewportRef} className="px-1">
								<MessageScrollerContent className="gap-0.5 px-2 py-3">
									{displayMessages.length === 0 ? (
										<p className="py-8 text-center text-xs text-muted-foreground">
											{view === "self" ? "No saved messages yet." : "No messages yet. Say hello!"}
										</p>
									) : (
										displayMessages.map((msg, i) => {
											const prev = displayMessages[i - 1];
											const compact = prev !== undefined && prev.sender.id === msg.sender.id;
											return (
												<MessageScrollerItem
													key={msg.id}
													scrollAnchor={i === displayMessages.length - 1}
													ref={(el) => {
														if (el) messageRefs.current.set(msg.id, el);
														else messageRefs.current.delete(msg.id);
													}}
												>
													<ContextMenu>
														<ContextMenuTrigger>
															<ChatMessageBubble
																message={msg}
																isOwn={msg.sender.id === currentUserId}
																compact={compact}
																onReplyClick={scrollToMessage}
															/>
														</ContextMenuTrigger>
														<ContextMenuContent>
															<ContextMenuItem
																onClick={() => {
																	setReplyingTo({
																		id: msg.id,
																		content: msg.content.slice(0, 120),
																		sender: { id: msg.sender.id, name: msg.sender.name },
																	});
																	inputRef.current?.focus();
																}}
															>
																Reply
															</ContextMenuItem>
														</ContextMenuContent>
													</ContextMenu>
												</MessageScrollerItem>
											);
										})
									)}
								</MessageScrollerContent>
							</MessageScrollerViewport>
						</MessageScroller>
					</MessageScrollerProvider>

					{replyingTo ? (
						<div className="mx-2 flex items-stretch gap-2 rounded-t-xl bg-primary/[0.04] px-2.5 py-1.5">
							<div className="w-[3px] shrink-0 rounded-full bg-primary" />
							<div className="min-w-0 flex-1">
								<span className="text-[11px] font-semibold text-primary">
									Replying to {replyingTo.sender.name}
								</span>
								<p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/60">
									{replyingTo.content}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="mt-0.5 size-5 shrink-0 rounded-full p-0"
								onClick={() => {
									setReplyingTo(null);
									inputRef.current?.focus();
								}}
							>
								<X className="size-3" />
							</Button>
						</div>
					) : null}

					{imagePreview ? (
						<div className="relative mx-3 overflow-hidden rounded-lg border border-sidebar-border/50">
							<img src={imagePreview} alt="Preview" className="max-h-24 w-full object-contain" />
							<Button
								variant="ghost"
								size="sm"
								className="absolute right-1 top-1 size-5 rounded-full p-0"
								onClick={() => {
									setImagePreview(null);
									if (fileInputRef.current) fileInputRef.current.value = "";
								}}
							>
								<X className="size-3" />
							</Button>
						</div>
					) : null}

					<div className="mx-2 mb-2 flex items-end rounded-[20px] bg-input/50 px-1.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/30">
						<input
							ref={fileInputRef}
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							className="hidden"
							onChange={handleFileChange}
						/>
						<Button
							variant="ghost"
							size="sm"
							className="mb-0.5 size-8 shrink-0 rounded-full p-0 text-muted-foreground/50"
							onClick={() => fileInputRef.current?.click()}
							disabled={sending}
						>
							<Paperclip className="size-4" />
						</Button>
						<textarea
							ref={inputRef}
							value={text}
							onChange={(e) => setText(e.currentTarget.value)}
							onKeyDown={handleKeyDown}
							onPaste={handlePaste}
							placeholder="Type a message…"
							className="min-h-[80px] max-h-32 w-full resize-none bg-transparent px-1.5 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
							disabled={sending}
							rows={1}
						/>
						<Button
							size="sm"
							className="mb-0.5 size-8 shrink-0 rounded-full p-0"
							onClick={() => void handleSend()}
							disabled={sending || (!text.trim() && !imagePreview)}
						>
							{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
						</Button>
					</div>
				</>
			)}
			<div
				className="absolute bottom-0 right-0 z-10 flex size-4 cursor-nwse-resize items-center justify-center rounded-bl-md"
				onPointerDown={handleResizePointerDown}
				onPointerMove={handleResizePointerMove}
				onPointerUp={handleResizePointerEnd}
				onPointerCancel={handleResizePointerEnd}
			>
				<div className="size-3 rotate-45 border-r-2 border-b-2 border-muted-foreground/30" />
			</div>
		</div>
	);
};
