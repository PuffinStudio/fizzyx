import { useEffect, useState } from "react";
import type { ChatUser } from "../../../domain/chat";
import { PeerJSSignalProvider } from "../../../adapters/chat-peerjs";
import { SubtleCryptoService } from "../../../adapters/chat-crypto-subtle";
import { IndexedDBChatStorage } from "../../../adapters/chat-indexeddb";
import type {
	CryptoService,
	SignalProvider,
	ChatStorage,
	SignalServerConfig,
} from "../../../ports";
import { ChatProvider } from "./chat-provider";
import { ChatPanel } from "./chat-panel";

export interface TeamChatProps {
	readonly open: boolean;
	readonly account: string;
	readonly board: string;
	readonly identity: ChatUser;
	readonly members: ReadonlyArray<ChatUser>;
	readonly signalServer?: SignalServerConfig;
	readonly onClose: () => void;
}

export const TeamChat = ({
	open,
	account,
	board,
	identity,
	members,
	signalServer,
	onClose,
}: TeamChatProps) => {
	const [adapters, setAdapters] = useState<{
		signal: SignalProvider;
		crypto: CryptoService;
		selfCrypto: CryptoService;
		storage: ChatStorage;
		selfRoomKey?: string;
	} | null>(null);

	useEffect(() => {
		if (!open) {
			setAdapters(null);
			return;
		}

		const signal = new PeerJSSignalProvider();
		const crypto = new SubtleCryptoService();
		const selfCrypto = new SubtleCryptoService();
		const storage = new IndexedDBChatStorage();
		let active = true;

		void fetch("/api/planner/self-chat-key")
			.then(async (response) => {
				if (!response.ok) return {};
				return (await response.json()) as { key?: string };
			})
			.catch(() => undefined)
			.then((data) => {
				if (!active) return;
				const selfRoomKey =
					data && typeof data === "object" && "key" in data && typeof data.key === "string"
						? data.key
						: undefined;
				setAdapters({ signal, crypto, selfCrypto, storage, selfRoomKey });
			});

		return () => {
			active = false;
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
			selfCryptoService={adapters.selfCrypto}
			selfRoomKey={adapters.selfRoomKey}
			storage={adapters.storage}
			signalServer={signalServer}
		>
			<ChatPanel onClose={onClose} />
		</ChatProvider>
	);
};
