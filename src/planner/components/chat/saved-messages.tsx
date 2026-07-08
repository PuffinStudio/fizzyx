import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowLeft, Bookmark, Send, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IndexedDBChatStorage } from "../../../adapters/chat-indexeddb";
import { PeerJSSignalProvider } from "../../../adapters/chat-peerjs";
import { SubtleCryptoService } from "../../../adapters/chat-crypto-subtle";
import type { ChatMessage, EncryptedPayload } from "../../../domain/chat";
import { deriveSelfRoomId, MAX_MESSAGE_LENGTH, decryptMessage } from "../../../domain/chat";
import { ChatMessageBubble } from "./chat-message-bubble";

export interface SavedMessagesProps {
	readonly userId: string;
	readonly userName: string;
	readonly open: boolean;
	readonly onClose: () => void;
	readonly onBackToChat?: () => void;
}

const makeId = (): string => `self_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

const encryptForStorage = async (
	crypto: SubtleCryptoService,
	plaintext: string,
): Promise<EncryptedPayload> => crypto.encrypt(plaintext);

interface SelfMessageServerRecord {
	readonly id: string;
	readonly encrypted: boolean;
	readonly encryptedPayload?: { readonly iv: string; readonly ciphertext: string };
	readonly type: string;
	readonly createdAt: string;
}

export const SavedMessages = ({
	userId,
	userName,
	open,
	onClose,
	onBackToChat,
}: SavedMessagesProps) => {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [connected, setConnected] = useState(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const signalRef = useRef<PeerJSSignalProvider | null>(null);
	const storageRef = useRef<IndexedDBChatStorage | null>(null);
	const cryptoRef = useRef<SubtleCryptoService | null>(null);
	const messagesRef = useRef<ChatMessage[]>([]);
	const roomIdRef = useRef("");
	const readyRef = useRef(false);

	const sender = { id: userId, name: userName };

	const scrollToBottom = useCallback(() => {
		const el = viewportRef.current;
		if (!el) return;
		requestAnimationFrame(() => {
			el.scrollTop = el.scrollHeight;
		});
	}, []);

	const decryptAndAdd = useCallback(
		async (encrypted: ChatMessage) => {
			if (messagesRef.current.some((m) => m.id === encrypted.id)) return;
			const decrypted = await decryptMessage(encrypted, cryptoRef.current!);
			messagesRef.current = [...messagesRef.current, decrypted];
			setMessages(messagesRef.current);
			void storageRef.current?.save(encrypted);
			scrollToBottom();
		},
		[scrollToBottom],
	);

	useEffect(() => {
		if (!open) {
			signalRef.current?.disconnect();
			signalRef.current = null;
			storageRef.current = null;
			cryptoRef.current = null;
			readyRef.current = false;
			setMessages([]);
			messagesRef.current = [];
			setConnected(false);
			return;
		}

		const roomId = deriveSelfRoomId(userId);
		roomIdRef.current = roomId;
		const storage = new IndexedDBChatStorage();
		const signal = new PeerJSSignalProvider();
		const crypto = new SubtleCryptoService();
		storageRef.current = storage;
		signalRef.current = signal;
		cryptoRef.current = crypto;

		const init = async () => {
			const roomKey = await crypto.deriveRoomKey(userId, "__self__");
			await crypto.init(roomKey);

			try {
				await signal.connect(roomId, { id: userId, name: userName });
				setConnected(true);
			} catch {
				setConnected(false);
			}

			readyRef.current = true;

			const saved = await storage.getHistory(roomId, { limit: 200 });
			for (const msg of saved) {
				const display = await decryptMessage(msg, crypto);
				messagesRef.current = [...messagesRef.current, display];
			}
			setMessages(messagesRef.current);
			scrollToBottom();

			try {
				const res = await fetch(`/api/chat/self-messages?userId=${encodeURIComponent(userId)}`);
				if (res.ok) {
					const serverMsgs = (await res.json()) as SelfMessageServerRecord[];
					for (const sm of serverMsgs) {
						const exists = messagesRef.current.some((m) => m.id === sm.id);
						if (!exists && sm.encryptedPayload) {
							const enc: ChatMessage = {
								id: sm.id,
								roomId,
								sender: { id: userId, name: userName },
								content: "",
								type: sm.type === "image" ? "image" : "text",
								createdAt: sm.createdAt,
								encrypted: true,
								encryptedPayload: sm.encryptedPayload,
							};
							void decryptAndAdd(enc);
						}
					}
				}
			} catch {}
		};

		signal.onMessage((event) => {
			const payload = event.data as {
				type?: string;
				msgId?: string;
				encrypted?: EncryptedPayload;
				msgType?: string;
				createdAt?: string;
			};
			if (!payload.encrypted) return;

			const enc: ChatMessage = {
				id: payload.msgId ?? makeId(),
				roomId,
				sender: event.from.user,
				content: "",
				type: payload.msgType === "image" ? "image" : "text",
				createdAt: payload.createdAt ?? new Date().toISOString(),
				encrypted: true,
				encryptedPayload: payload.encrypted,
			};
			void decryptAndAdd(enc);
		});

		signal.onConnectionStateChange((state) => {
			if (state === "connected") setConnected(true);
			else if (state === "disconnected" || state === "error") setConnected(false);
		});

		void init();

		return () => {
			signal.disconnect();
			readyRef.current = false;
		};
	}, [open, userId, userName, scrollToBottom, decryptAndAdd]);

	useEffect(() => {
		scrollToBottom();
	}, [messages, scrollToBottom]);

	const handleSend = async () => {
		const trimmed = text.trim();
		if (!trimmed || sending || !readyRef.current || !cryptoRef.current) return;
		if (trimmed.length > MAX_MESSAGE_LENGTH) return;
		setSending(true);
		try {
			const encrypted = await encryptForStorage(cryptoRef.current, trimmed);

			const enc: ChatMessage = {
				id: makeId(),
				roomId: roomIdRef.current,
				sender,
				content: "",
				type: "text",
				createdAt: new Date().toISOString(),
				encrypted: true,
				encryptedPayload: encrypted,
			};

			const display = await decryptMessage(enc, cryptoRef.current);
			messagesRef.current = [...messagesRef.current, display];
			setMessages(messagesRef.current);
			setText("");

			if (signalRef.current && connected) {
				signalRef.current.send({
					type: "chat",
					msgId: enc.id,
					msgType: "text",
					encrypted,
					createdAt: enc.createdAt,
				});
			}

			void storageRef.current?.save(enc);

			void fetch("/api/chat/self-messages", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					userId,
					id: enc.id,
					encrypted: true,
					encryptedPayload: encrypted,
					type: "text",
					createdAt: enc.createdAt,
				}),
			});
		} finally {
			setSending(false);
			inputRef.current?.focus();
			scrollToBottom();
		}
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			void handleSend();
		}
	};

	if (!open) return null;

	return (
		<div
			className="fixed bottom-4 right-4 z-50 flex w-[400px] flex-col rounded-2xl border border-sidebar-border/70 bg-background/95 shadow-xl backdrop-blur-xl"
			style={{ height: "500px" }}
		>
			<div className="flex items-center justify-between rounded-t-2xl border-b border-sidebar-border/20 px-3 py-2.5">
				<div className="flex items-center gap-2">
					{onBackToChat ? (
						<button
							type="button"
							onClick={onBackToChat}
							className="flex size-6 items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground transition-colors"
							title="Back to Chat"
						>
							<ArrowLeft className="size-3.5" />
						</button>
					) : null}
					<Bookmark className="size-4 text-muted-foreground/60" />
					<span className="text-sm font-medium">Saved Messages</span>
					<div
						className={cn(
							"size-1.5 rounded-full",
							connected ? "bg-green-500" : "bg-muted-foreground/30",
						)}
					/>
				</div>
				<Button variant="ghost" size="sm" className="size-7 rounded-full p-0" onClick={onClose}>
					<X className="size-4" />
				</Button>
			</div>

			<div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
				{messages.length === 0 ? (
					<p className="py-8 text-center text-xs text-muted-foreground">
						No saved messages yet. Write something to remember!
					</p>
				) : (
					<div className="flex flex-col gap-0.5">
						{messages.map((msg, i) => {
							const prev = messages[i - 1];
							const compact = prev !== undefined && prev.sender.id === msg.sender.id;
							return (
								<ChatMessageBubble key={msg.id} message={msg} isOwn={true} compact={compact} />
							);
						})}
					</div>
				)}
			</div>

			<div className="mx-2 mb-2 flex items-end rounded-[20px] bg-input/50 px-1.5 py-1.5 focus-within:ring-2 focus-within:ring-ring/30">
				<textarea
					ref={inputRef}
					value={text}
					onChange={(e) => setText(e.currentTarget.value)}
					onKeyDown={handleKeyDown}
					placeholder="Save a message…"
					className="min-h-[40px] max-h-32 w-full resize-none bg-transparent px-1.5 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/50"
					disabled={sending}
					rows={1}
				/>
				<Button
					size="sm"
					className="mb-0.5 size-8 shrink-0 rounded-full p-0"
					onClick={() => void handleSend()}
					disabled={sending || !text.trim()}
				>
					{sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
				</Button>
			</div>
		</div>
	);
};
