import type { ChatUser } from "../domain/chat";
import { ChatConnectionError } from "../domain/chat-errors";
import type {
	SignalMessageEvent,
	SignalPeerEvent,
	SignalProvider,
	SignalServerConfig,
} from "../ports/chat-signal";
import { DEFAULT_SIGNAL_SERVER } from "../ports/chat-signal";

interface PeerModule {
	new (
		id: string,
		options?: {
			host?: string;
			port?: number;
			path?: string;
			secure?: boolean;
			key?: string;
			debug?: number;
		},
	): PeerInstance;
}

interface PeerInstance {
	on(event: "open", handler: (id: string) => void): void;
	on(event: "connection", handler: (conn: DataConnection) => void): void;
	on(event: "error", handler: (err: Error) => void): void;
	on(event: "disconnected", handler: () => void): void;
	on(event: "close", handler: () => void): void;
	off(event: string, handler: (...args: any[]) => void): void;
	connect(peerId: string, options?: { reliable?: boolean }): DataConnection;
	disconnect(): void;
	destroy(): void;
	id: string;
}

interface DataConnection {
	on(event: "open", handler: () => void): void;
	on(event: "data", handler: (data: unknown) => void): void;
	on(event: "close", handler: () => void): void;
	on(event: "error", handler: (err: Error) => void): void;
	send(data: unknown): void;
	close(): void;
	peer: string;
	metadata?: unknown;
}

const SYSTEM_PREFIX = "__peer_handshake__";

export interface PeerJSOptions {
	readonly signalServer?: SignalServerConfig;
	readonly debug?: boolean;
}

export class PeerJSSignalProvider implements SignalProvider {
	private peer: PeerInstance | null = null;
	private connections = new Map<string, DataConnection>();
	private peers = new Map<string, SignalPeerEvent>();
	private messageHandlers: Array<(event: SignalMessageEvent) => void> = [];
	private peerJoinHandlers: Array<(event: SignalPeerEvent) => void> = [];
	private peerLeaveHandlers: Array<(event: SignalPeerEvent) => void> = [];
	private stateHandlers: Array<
		(state: "connecting" | "connected" | "disconnected" | "error") => void
	> = [];
	private identity: ChatUser | null = null;
	private roomId: string | null = null;
	private receivedMsgIds = new Set<string>();

	async connect(
		roomId: string,
		identity: ChatUser,
		signalServer?: SignalServerConfig,
	): Promise<void> {
		this.disconnect();
		this.identity = identity;
		this.roomId = roomId;

		const config = signalServer ?? DEFAULT_SIGNAL_SERVER;
		const { host, port, path, secure, key } = config;

		const Peer = await loadPeerJS();
		const selfId = `${roomId}_${identity.id}`;

		this.setState("connecting");

		this.peer = new Peer(selfId, {
			host,
			port,
			path,
			secure,
			...(key ? { key } : {}),
			debug: 0,
		}) as PeerInstance;

		return new Promise<void>((resolve, reject) => {
			if (!this.peer) return reject(new ChatConnectionError("Peer not initialized"));

			const cleanup = () => {
				this.peer?.off("open", onOpen);
				this.peer?.off("error", onError);
			};

			const onOpen = () => {
				this.setState("connected");
				cleanup();
				resolve();

				this.announcePresence();
			};

			const onError = (err: Error) => {
				cleanup();
				this.setState("error");
				reject(new ChatConnectionError("Failed to connect to signaling server", err));
			};

			this.peer.on("open", onOpen);
			this.peer.on("error", onError);
			this.peer.on("connection", (conn) => this.handleIncoming(conn));
			this.peer.on("disconnected", () => this.setState("disconnected"));
			this.peer.on("close", () => this.setState("disconnected"));
		});
	}

	disconnect(): void {
		for (const conn of this.connections.values()) {
			try {
				conn.close();
			} catch {
				/* ignore */
			}
		}
		this.connections.clear();
		this.peers.clear();
		if (this.peer) {
			try {
				this.peer.destroy();
			} catch {
				/* ignore */
			}
			this.peer = null;
		}
		this.receivedMsgIds.clear();
		this.messageHandlers = [];
		this.peerJoinHandlers = [];
		this.peerLeaveHandlers = [];
		this.stateHandlers = [];
		this.identity = null;
		this.roomId = null;
		this.setState("disconnected");
	}

	send(data: unknown): void {
		const payload = { from: this.getSelfPeer(), data };
		for (const conn of this.connections.values()) {
			try {
				conn.send(payload);
			} catch {
				/* ignore */
			}
		}
	}

	sendTo(peerId: string, data: unknown): void {
		const conn = this.connections.get(peerId);
		if (!conn) return;
		const payload = { from: this.getSelfPeer(), data };
		try {
			conn.send(payload);
		} catch {
			/* ignore */
		}
	}

	getPeers(): SignalPeerEvent[] {
		return Array.from(this.peers.values());
	}

	onMessage(handler: (event: SignalMessageEvent) => void): void {
		this.messageHandlers.push(handler);
	}

	onPeerJoin(handler: (event: SignalPeerEvent) => void): void {
		this.peerJoinHandlers.push(handler);
	}

	onPeerLeave(handler: (event: SignalPeerEvent) => void): void {
		this.peerLeaveHandlers.push(handler);
	}

	onConnectionStateChange(
		handler: (state: "connecting" | "connected" | "disconnected" | "error") => void,
	): void {
		this.stateHandlers.push(handler);
	}

	// ─── Private ──────────────────────────────────────────

	private setState(state: "connecting" | "connected" | "disconnected" | "error") {
		for (const h of this.stateHandlers) h(state);
	}

	private getSelfPeer(): SignalPeerEvent | null {
		if (!this.identity || !this.peer) return null;
		return { peerId: this.peer.id, user: this.identity };
	}

	private announcePresence() {
		if (!this.identity || !this.peer) return;
		const payload = {
			type: `${SYSTEM_PREFIX}_presence`,
			user: this.identity,
		};
		for (const conn of this.connections.values()) {
			try {
				conn.send(payload);
			} catch {
				/* ignore */
			}
		}
	}

	private handleIncoming(conn: DataConnection) {
		const peerId = conn.peer;

		conn.on("open", () => {
			this.connections.set(peerId, conn);
			if (this.identity) {
				conn.send({
					type: `${SYSTEM_PREFIX}_presence`,
					user: this.identity,
				});
			}
		});

		conn.on("data", (raw: unknown) => {
			const msg = raw as {
				type?: string;
				msgId?: string;
				from?: SignalPeerEvent;
				data?: unknown;
				user?: ChatUser;
			};

			if (msg.msgId && this.receivedMsgIds.has(msg.msgId)) return;
			if (msg.msgId) this.receivedMsgIds.add(msg.msgId);

			if (msg.type === `${SYSTEM_PREFIX}_presence` && msg.user) {
				const event: SignalPeerEvent = { peerId, user: msg.user };
				this.peers.set(peerId, event);
				for (const h of this.peerJoinHandlers) h(event);
				return;
			}

			if (msg.type === `${SYSTEM_PREFIX}_leave`) {
				const existing = this.peers.get(peerId);
				if (existing) {
					this.peers.delete(peerId);
					for (const h of this.peerLeaveHandlers) h(existing);
				}
				return;
			}

			const fromEvent = this.peers.get(peerId);
			if (!fromEvent) return;

			const messageEvent: SignalMessageEvent = {
				from: fromEvent,
				data: msg,
			};
			for (const h of this.messageHandlers) h(messageEvent);
		});

		conn.on("close", () => {
			this.connections.delete(peerId);
			const existing = this.peers.get(peerId);
			if (existing) {
				this.peers.delete(peerId);
				for (const h of this.peerLeaveHandlers) h(existing);
			}
		});

		conn.on("error", () => {
			this.connections.delete(peerId);
		});
	}
}

let peerJSPromise: Promise<unknown> | null = null;

const loadPeerJS = async (): Promise<PeerModule> => {
	if (peerJSPromise === null) {
		peerJSPromise = import("peerjs");
	}
	const mod = (await peerJSPromise) as { default?: unknown; Peer?: unknown };
	const Peer = (mod.default ?? mod.Peer) as PeerModule;
	return Peer;
};
