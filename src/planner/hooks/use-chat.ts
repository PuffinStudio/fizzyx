import { useCallback, useEffect, useRef, useState } from "react";
import type {
	ChatMessage,
	ChatUser,
	ChatConnectionState,
	MessageReplyRef,
} from "../../domain/chat";
import type { CryptoService } from "../../ports/chat-crypto";
import type { SignalProvider, SignalServerConfig } from "../../ports/chat-signal";
import type { ChatStorage } from "../../ports/chat-storage";
import type { ChatUseCase } from "../../use-cases/chat";
import { createChatUseCase } from "../../use-cases/chat";

export interface UseChatOptions {
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly signalProvider?: SignalProvider;
	readonly cryptoService?: CryptoService;
	readonly storage?: ChatStorage;
	readonly signalServer?: SignalServerConfig;
	readonly autoConnect?: boolean;
}

export interface UseChatReturn {
	messages: ChatMessage[];
	connectedPeers: ChatUser[];
	connectionState: ChatConnectionState;
	connect: () => Promise<void>;
	disconnect: () => void;
	sendText: (content: string, replyTo?: MessageReplyRef) => Promise<void>;
	sendImage: (file: File) => Promise<void>;
	loadHistory: () => Promise<ChatMessage[]>;
	loadMore: (beforeTimestamp: string) => Promise<ChatMessage[]>;
}

export const useChat = (options: UseChatOptions): UseChatReturn => {
	const {
		account,
		board,
		identity,
		signalProvider,
		cryptoService,
		storage,
		signalServer,
		autoConnect = false,
	} = options;

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [connectedPeers, setConnectedPeers] = useState<ChatUser[]>([]);
	const [connectionState, setConnectionState] = useState<ChatConnectionState>("disconnected");

	const chatRef = useRef<ChatUseCase | null>(null);
	const messagesRef = useRef<ChatMessage[]>([]);

	useEffect(() => {
		if (!signalProvider || !cryptoService || !storage) return;

		const chat = createChatUseCase({
			account,
			board,
			identity,
			signalProvider,
			cryptoService,
			storage,
			signalServer,
		});

		chatRef.current = chat;

		chat.onMessage((msg) => {
			messagesRef.current = [...messagesRef.current, msg];
			setMessages(messagesRef.current);
		});

		chat.onPeerJoin((user) => {
			setConnectedPeers((prev) => {
				if (prev.some((p) => p.id === user.id)) return prev;
				return [...prev, user];
			});
		});

		chat.onPeerLeave((user) => {
			setConnectedPeers((prev) => prev.filter((p) => p.id !== user.id));
		});

		chat.onConnectionState((state) => {
			setConnectionState(state as ChatConnectionState);
		});

		if (autoConnect) {
			void chat.connect();
		}

		return () => {
			chat.disconnect();
			chatRef.current = null;
		};
	}, [account, board, identity, signalProvider, cryptoService, storage]);

	const connect = useCallback(async () => {
		await chatRef.current?.connect();
	}, []);

	const disconnect = useCallback(() => {
		chatRef.current?.disconnect();
		messagesRef.current = [];
		setMessages([]);
	}, []);

	const sendText = useCallback(async (content: string, replyTo?: MessageReplyRef) => {
		await chatRef.current?.sendText(content, replyTo);
	}, []);

	const sendImage = useCallback(async (file: File) => {
		await chatRef.current?.sendImage(file);
	}, []);

	const loadHistory = useCallback(async () => {
		if (!chatRef.current) return [];
		const history = await chatRef.current.loadHistory();
		messagesRef.current = history;
		setMessages(history);
		return history;
	}, []);

	const loadMore = useCallback(async (beforeTimestamp: string) => {
		if (!chatRef.current) return [];
		return chatRef.current.loadMore(beforeTimestamp);
	}, []);

	return {
		messages,
		connectedPeers,
		connectionState,
		connect,
		disconnect,
		sendText,
		sendImage,
		loadHistory,
		loadMore,
	};
};
