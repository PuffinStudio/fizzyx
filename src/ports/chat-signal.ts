import type { ChatUser } from "../domain/chat";

export interface SignalPeerEvent {
	readonly peerId: string;
	readonly user: ChatUser;
}

export interface SignalMessageEvent {
	readonly from: SignalPeerEvent;
	readonly data: unknown;
}

export interface SignalProvider {
	connect(
		roomId: string,
		identity: ChatUser,
		signalServer?: SignalServerConfig,
		peers?: ReadonlyArray<ChatUser>,
	): Promise<void>;
	disconnect(): void;
	send(data: unknown): void;
	sendTo(peerId: string, data: unknown): void;
	getPeers(): SignalPeerEvent[];
	onMessage(handler: (event: SignalMessageEvent) => void): void;
	onPeerJoin(handler: (event: SignalPeerEvent) => void): void;
	onPeerLeave(handler: (event: SignalPeerEvent) => void): void;
	onConnectionStateChange(
		handler: (state: "connecting" | "connected" | "disconnected" | "error") => void,
	): void;
}

export interface SignalServerConfig {
	readonly host: string;
	readonly port?: number;
	readonly path?: string;
	readonly secure?: boolean;
	readonly key?: string;
}

export const DEFAULT_SIGNAL_SERVER: SignalServerConfig = {
	host: "0.peerjs.com",
	port: 443,
	path: "/",
	secure: true,
};
