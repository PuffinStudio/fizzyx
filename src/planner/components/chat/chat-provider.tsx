import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ChatUser } from "../../../domain/chat";
import type {
	CryptoService,
	SignalProvider,
	ChatStorage,
	SignalServerConfig,
} from "../../../ports";
import { useChat, type UseChatReturn } from "../../hooks/use-chat";

export interface ChatContextValue extends UseChatReturn {
	readonly enabled: boolean;
	readonly currentUserId: string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
	readonly children: ReactNode;
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly signalProvider: SignalProvider;
	readonly cryptoService: CryptoService;
	readonly storage: ChatStorage;
	readonly signalServer?: SignalServerConfig;
	readonly autoConnect?: boolean;
}

export const ChatProvider = ({
	children,
	account,
	board,
	identity,
	signalProvider,
	cryptoService,
	storage,
	signalServer,
	autoConnect = true,
}: ChatProviderProps) => {
	const chat = useChat({
		account,
		board,
		identity,
		signalProvider,
		cryptoService,
		storage,
		signalServer,
		autoConnect,
	});

	const value = useMemo(
		() => ({ ...chat, enabled: true, currentUserId: identity.id }),
		[chat, identity.id],
	);

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextValue => {
	const ctx = useContext(ChatContext);
	if (!ctx) {
		return {
			enabled: false,
			currentUserId: "",
			messages: [],
			connectedPeers: [],
			connectionState: "disconnected",
			connect: async () => {},
			disconnect: () => {},
			sendText: async () => {},
			sendImage: async () => {},
			loadHistory: async () => [],
			loadMore: async () => [],
		};
	}
	return ctx;
};
