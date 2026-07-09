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
	readonly currentUserName: string;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export interface ChatProviderProps {
	readonly children: ReactNode;
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly members?: ReadonlyArray<ChatUser>;
	readonly signalProvider: SignalProvider;
	readonly cryptoService: CryptoService;
	readonly selfCryptoService?: CryptoService;
	readonly selfRoomKey?: string;
	readonly storage: ChatStorage;
	readonly signalServer?: SignalServerConfig;
	readonly autoConnect?: boolean;
}

export const ChatProvider = ({
	children,
	account,
	board,
	identity,
	members,
	signalProvider,
	cryptoService,
	selfCryptoService,
	selfRoomKey,
	storage,
	signalServer,
	autoConnect = true,
}: ChatProviderProps) => {
	const chat = useChat({
		account,
		board,
		identity,
		members,
		signalProvider,
		cryptoService,
		selfCryptoService,
		selfRoomKey,
		storage,
		signalServer,
		autoConnect,
	});

	const value = useMemo(
		() => ({ ...chat, enabled: true, currentUserId: identity.id, currentUserName: identity.name }),
		[chat, identity.id, identity.name],
	);

	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChatContext = (): ChatContextValue => {
	const ctx = useContext(ChatContext);
	if (!ctx) {
		return {
			enabled: false,
			currentUserId: "",
			currentUserName: "",
			messages: [],
			selfMessages: [],
			connectedPeers: [],
			connectionState: "disconnected",
			connect: async () => {},
			disconnect: () => {},
			sendText: async () => {},
			sendSelfText: async () => {},
			sendImage: async () => {},
			sendSelfImage: async () => {},
			loadHistory: async () => [],
			loadSelfHistory: async () => [],
			loadMore: async () => [],
		};
	}
	return ctx;
};
