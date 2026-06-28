import { useEffect, useState } from "react";
import type { ChatUser } from "../../../domain/chat";
import { PeerJSSignalProvider } from "../../../adapters/chat-peerjs";
import { SubtleCryptoService } from "../../../adapters/chat-crypto-subtle";
import { IndexedDBChatStorage } from "../../../adapters/chat-indexeddb";
import type { CryptoService, SignalProvider, ChatStorage } from "../../../ports";
import { ChatProvider } from "./chat-provider";
import { ChatPanel } from "./chat-panel";

export interface TeamChatProps {
	readonly open: boolean;
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly members: ReadonlyArray<ChatUser>;
	readonly onClose: () => void;
}

export const TeamChat = ({ open, account, board, identity, members, onClose }: TeamChatProps) => {
	const [adapters, setAdapters] = useState<{
		signal: SignalProvider;
		crypto: CryptoService;
		storage: ChatStorage;
	} | null>(null);

	useEffect(() => {
		if (!open) {
			setAdapters(null);
			return;
		}

		const signal = new PeerJSSignalProvider();
		const crypto = new SubtleCryptoService();
		const storage = new IndexedDBChatStorage();
		setAdapters({ signal, crypto, storage });

		return () => {
			signal.disconnect();
		};
	}, [open]);

	if (!open || !adapters) return null;

	return (
		<ChatProvider
			account={account}
			board={board}
			identity={identity}
			members={members}
			signalProvider={adapters.signal}
			cryptoService={adapters.crypto}
			storage={adapters.storage}
		>
			<ChatPanel onClose={onClose} />
		</ChatProvider>
	);
};
