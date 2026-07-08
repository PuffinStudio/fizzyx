import type {
	ChatMessage,
	ChatMessageType,
	ChatUser,
	EncryptedPayload,
	MessageReplyRef,
} from "../domain/chat";
import { decryptMessage, deriveSelfRoomId, MAX_IMAGE_SIZE_BYTES, IMAGE_MIME_TYPES } from "../domain/chat";
import { ChatValidationError } from "../domain/chat-errors";
import type { CryptoService } from "../ports/chat-crypto";
import type { SignalProvider } from "../ports/chat-signal";
import type { ChatStorage } from "../ports/chat-storage";

export interface ChatUseCase {
	connect(): Promise<void>;
	disconnect(): void;
	sendText(content: string, replyTo?: MessageReplyRef): Promise<void>;
	sendSelfText(content: string): Promise<void>;
	sendImage(file: File): Promise<void>;
	loadHistory(): Promise<ChatMessage[]>;
	loadSelfHistory(): Promise<ChatMessage[]>;
	loadMore(beforeTimestamp: string): Promise<ChatMessage[]>;
	onMessage(handler: (msg: ChatMessage) => void): void;
	onSelfMessage(handler: (msg: ChatMessage) => void): void;
	onPeerJoin(handler: (user: ChatUser) => void): void;
	onPeerLeave(handler: (user: ChatUser) => void): void;
	onConnectionState(handler: (state: string) => void): void;
	getConnectedPeers(): ChatUser[];
}

export interface ConnectParams {
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly members?: ReadonlyArray<ChatUser>;
	readonly signalProvider: SignalProvider;
	readonly cryptoService: CryptoService;
	readonly storage: ChatStorage;
	readonly signalServer?: {
		host: string;
		port?: number;
		path?: string;
		secure?: boolean;
		key?: string;
	};
}

const makeMessageId = (): string => `msg_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

const encodeImageToBase64 = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error("Failed to read image file"));
		reader.readAsDataURL(file);
	});

export const createChatUseCase = (params: ConnectParams): ChatUseCase => {
	const {
		account,
		board,
		identity,
		members,
		signalProvider,
		cryptoService,
		storage,
		signalServer,
	} = params;

	let roomId = `${account}/${board}`;
	let selfRoomId = "";
	let connected = false;
	const messageHandlers: Array<(msg: ChatMessage) => void> = [];
	const selfMessageHandlers: Array<(msg: ChatMessage) => void> = [];
	const peerJoinHandlers: Array<(user: ChatUser) => void> = [];
	const peerLeaveHandlers: Array<(user: ChatUser) => void> = [];
	const stateHandlers: Array<(state: string) => void> = [];
	const seenIds = new Set<string>();

	const notifyState = (state: string) => {
		for (const h of stateHandlers) h(state);
	};

	const broadcastDecrypted = async (msg: ChatMessage, isSelf = false) => {
		if (seenIds.has(msg.id)) return;
		seenIds.add(msg.id);

		const display = await decryptMessage(msg, cryptoService);
		if (isSelf) {
			for (const h of selfMessageHandlers) h(display);
		} else {
			for (const h of messageHandlers) h(display);
		}

		const storageMsg: ChatMessage = msg.content
			? {
					id: msg.id,
					roomId: msg.roomId,
					sender: msg.sender,
					content: "",
					type: msg.type,
					createdAt: msg.createdAt,
					encrypted: true,
					encryptedPayload: msg.encryptedPayload,
					encryptedReplyTo: msg.encryptedReplyTo,
				}
			: msg;
		void storage.save(storageMsg);
	};

	const deriveAndConnect = async () => {
		notifyState("initializing");

		const roomKey = await cryptoService.deriveRoomKey(account, board);
		await cryptoService.init(roomKey);
		roomId = roomKey.slice(0, 16);
		selfRoomId = deriveSelfRoomId(identity.id);

		void loadSavedHistory();
		void loadSavedSelfHistory();

		try {
			await signalProvider.connect(roomId, identity, signalServer, members);
			connected = true;
			notifyState("connected");
		} catch {
			notifyState("error");
		}
	};

	const loadSavedHistory = async () => {
		try {
			const saved = await storage.getHistory(roomId, { limit: 50 });
			for (const msg of saved) {
				if (seenIds.has(msg.id)) continue;
				seenIds.add(msg.id);
				const display = await decryptMessage(msg, cryptoService);
				for (const h of messageHandlers) h(display);
			}
		} catch {
			// history load is best-effort
		}
	};

	const loadSavedSelfHistory = async () => {
		if (!selfRoomId) return;
		try {
			const saved = await storage.getHistory(selfRoomId, { limit: 200 });
			for (const msg of saved) {
				if (seenIds.has(msg.id)) continue;
				seenIds.add(msg.id);
				const display = await decryptMessage(msg, cryptoService);
				for (const h of selfMessageHandlers) h(display);
			}
		} catch {
			// history load is best-effort
		}
	};

	signalProvider.onMessage((event) => {
		type SignalPayload = {
			type?: string;
			content?: string;
			encrypted?: EncryptedPayload;
			msgType?: ChatMessageType;
			msgId?: string;
			createdAt?: string;
			encryptedReplyTo?: EncryptedPayload;
			scope?: string;
		};

		const payload = event.data as SignalPayload;

		if (!payload.encrypted) return;

		const isSelf = payload.scope === "self" && event.from.user.id === identity.id;

		if (payload.scope === "self" && !isSelf) return;

		const resolveContent = async () => {
			let decrypted: string;
			try {
				decrypted = await cryptoService.decrypt(payload.encrypted!);
			} catch {
				decrypted = "[decryption failed]";
			}

			let replyTo: MessageReplyRef | undefined;
			if (payload.encryptedReplyTo) {
				try {
					const decryptedReply = await cryptoService.decrypt(payload.encryptedReplyTo);
					replyTo = JSON.parse(decryptedReply) as MessageReplyRef;
				} catch {
					// reply metadata unrecoverable, skip
				}
			}

			const msg: ChatMessage = {
				id: payload.msgId ?? makeMessageId(),
				roomId: isSelf ? selfRoomId : roomId,
				sender: event.from.user,
				content: decrypted,
				type: payload.msgType ?? "text",
				createdAt: payload.createdAt ?? new Date().toISOString(),
				encrypted: true,
				encryptedPayload: payload.encrypted,
				replyTo,
				encryptedReplyTo: payload.encryptedReplyTo,
			};
			void broadcastDecrypted(msg, isSelf);
		};

		void resolveContent();
	});

	signalProvider.onPeerJoin((event) => {
		for (const h of peerJoinHandlers) h(event.user);
	});

	signalProvider.onPeerLeave((event) => {
		for (const h of peerLeaveHandlers) h(event.user);
	});

	return {
		async connect() {
			await deriveAndConnect();
		},

		disconnect() {
			connected = false;
			signalProvider.disconnect();
			notifyState("disconnected");
		},

		async sendText(content: string, replyTo?: MessageReplyRef) {
			if (!connected) throw new ChatValidationError("Not connected to chat room");
			const trimmed = content.trim();
			if (!trimmed) throw new ChatValidationError("Message cannot be empty");
			if (trimmed.length > 5000) throw new ChatValidationError("Message too long (max 5000 chars)");

			const encrypted = await cryptoService.encrypt(trimmed);

			let encryptedReplyTo: EncryptedPayload | undefined;
			if (replyTo) {
				encryptedReplyTo = await cryptoService.encrypt(JSON.stringify(replyTo));
			}

			const msg: ChatMessage = {
				id: makeMessageId(),
				roomId,
				sender: identity,
				content: trimmed,
				type: "text",
				createdAt: new Date().toISOString(),
				encrypted: true,
				encryptedPayload: encrypted,
				replyTo,
				encryptedReplyTo,
			};

			signalProvider.send({
				type: "chat",
				msgId: msg.id,
				msgType: "text",
				encrypted,
				createdAt: msg.createdAt,
				encryptedReplyTo,
			});

			void broadcastDecrypted(msg);
		},

		async sendImage(file: File) {
			if (!connected) throw new ChatValidationError("Not connected to chat room");
			if (!IMAGE_MIME_TYPES.includes(file.type)) {
				throw new ChatValidationError("Unsupported image format. Use PNG, JPEG, GIF, or WebP");
			}
			if (file.size > MAX_IMAGE_SIZE_BYTES) {
				throw new ChatValidationError("Image too large (max 5MB)");
			}

			const base64 = await encodeImageToBase64(file);
			const encrypted = await cryptoService.encrypt(base64);

			const msg: ChatMessage = {
				id: makeMessageId(),
				roomId,
				sender: identity,
				content: base64,
				type: "image",
				createdAt: new Date().toISOString(),
				encrypted: true,
				encryptedPayload: encrypted,
			};

			signalProvider.send({
				type: "chat",
				msgId: msg.id,
				msgType: "image",
				encrypted,
				createdAt: msg.createdAt,
			});

			void broadcastDecrypted(msg);
		},

		async sendSelfText(content: string) {
			if (!connected) throw new ChatValidationError("Not connected to chat room");
			const trimmed = content.trim();
			if (!trimmed) throw new ChatValidationError("Message cannot be empty");
			if (trimmed.length > 5000) throw new ChatValidationError("Message too long (max 5000 chars)");

			const encrypted = await cryptoService.encrypt(trimmed);

			const msg: ChatMessage = {
				id: makeMessageId(),
				roomId: selfRoomId,
				sender: identity,
				content: trimmed,
				type: "text",
				createdAt: new Date().toISOString(),
				encrypted: true,
				encryptedPayload: encrypted,
			};

			signalProvider.send({
				type: "chat",
				scope: "self",
				msgId: msg.id,
				msgType: "text",
				encrypted,
				createdAt: msg.createdAt,
			});

			void broadcastDecrypted(msg, true);
		},

		async loadHistory() {
			const saved = await storage.getHistory(roomId, { limit: 50 });
			return Promise.all(saved.map((m) => decryptMessage(m, cryptoService)));
		},

		async loadSelfHistory() {
			const saved = await storage.getHistory(selfRoomId, { limit: 200 });
			return Promise.all(saved.map((m) => decryptMessage(m, cryptoService)));
		},

		async loadMore(beforeTimestamp: string) {
			const saved = await storage.getHistory(roomId, { before: beforeTimestamp, limit: 50 });
			return Promise.all(saved.map((m) => decryptMessage(m, cryptoService)));
		},

		onMessage(handler) {
			messageHandlers.push(handler);
		},

		onSelfMessage(handler) {
			selfMessageHandlers.push(handler);
		},

		onPeerJoin(handler) {
			peerJoinHandlers.push(handler);
		},

		onPeerLeave(handler) {
			peerLeaveHandlers.push(handler);
		},

		onConnectionState(handler) {
			stateHandlers.push(handler);
			if (connected) handler("connected");
		},

		getConnectedPeers() {
			return signalProvider.getPeers().map((p) => p.user);
		},
	};
};
