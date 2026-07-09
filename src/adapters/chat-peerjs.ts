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

type PeerError = Error & { type?: string };

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

type SignalWireMessage = {
	readonly type?: string;
	readonly msgId?: string;
	readonly from?: SignalPeerEvent | null;
	readonly data?: unknown;
	readonly user?: ChatUser;
};

const SYSTEM_PREFIX = "__peer_handshake__";

const getDeviceId = (): string => {
	try {
		let id = localStorage.getItem("fizzyx_peer_device_id");
		if (!id) {
			id = crypto.randomUUID().slice(0, 8);
			localStorage.setItem("fizzyx_peer_device_id", id);
		}
		return id;
	} catch {
		return crypto.randomUUID().slice(0, 8);
	}
};

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
	private selfDevicePeerId: string | null = null;
	private roomId: string | null = null;
	private receivedMsgIds = new Set<string>();
	private knownPeersList: ReadonlyArray<ChatUser> = [];

	async connect(
		roomId: string,
		identity: ChatUser,
		signalServer?: SignalServerConfig,
		peers: ReadonlyArray<ChatUser> = [],
	): Promise<void> {
		this.closePeer(false);
		this.identity = identity;
		this.roomId = roomId;
		this.knownPeersList = peers;
		this.selfDevicePeerId = null;

		const config = signalServer ?? DEFAULT_SIGNAL_SERVER;
		const { host, port, path, secure, key } = config;

		const Peer = await loadPeerJS();
		const basePeerId = `${roomId}_${identity.id}`;
		const deviceTag = getDeviceId();
		const devicePeerId = `${basePeerId}_${deviceTag}`;

		this.setState("connecting");

		const peerOptions = {
			host,
			port,
			path,
			secure,
			...(key ? { key } : {}),
			debug: 0,
		};

		try {
			await this.openPeer(Peer, basePeerId, peerOptions);
		} catch (err) {
			if (!isUnavailablePeerId(err)) {
				this.setState("error");
				throw new ChatConnectionError("Failed to connect to signaling server", err as Error);
			}
			await this.openPeer(Peer, devicePeerId, peerOptions).catch((fallbackErr) => {
				this.setState("error");
				throw new ChatConnectionError(
					"Failed to connect to signaling server",
					fallbackErr as Error,
				);
			});
		}

		if (!this.peer) throw new ChatConnectionError("Peer not initialized");
		this.selfDevicePeerId = this.peer.id;
		this.setState("connected");
		this.connectKnownPeers(peers);
		this.announcePresence();
	}

	private openPeer(
		Peer: PeerModule,
		peerId: string,
		options: ConstructorParameters<PeerModule>[1],
	): Promise<void> {
		this.peer = new Peer(peerId, options) as PeerInstance;
		return new Promise<void>((resolve, reject) => {
			const peer = this.peer;
			if (!peer) return reject(new ChatConnectionError("Peer not initialized"));
			const cleanup = () => {
				peer.off("open", onOpen);
				peer.off("error", onError);
			};
			const onOpen = () => {
				cleanup();
				resolve();
			};
			const onError = (err: Error) => {
				cleanup();
				try {
					peer.destroy();
				} catch {
					/* ignore */
				}
				if (this.peer === peer) this.peer = null;
				reject(err);
			};
			peer.on("open", onOpen);
			peer.on("error", onError);
			peer.on("connection", (conn) => this.handleIncoming(conn));
			peer.on("disconnected", () => this.setState("disconnected"));
			peer.on("close", () => this.setState("disconnected"));
		});
	}

	disconnect(): void {
		this.closePeer(true);
	}

	private closePeer(clearHandlers: boolean): void {
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
		if (clearHandlers) {
			this.messageHandlers = [];
			this.peerJoinHandlers = [];
			this.peerLeaveHandlers = [];
			this.stateHandlers = [];
		}
		this.identity = null;
		this.roomId = null;
		this.setState("disconnected");
	}

	send(data: unknown): void {
		const payload = { msgId: getPayloadMessageId(data), from: this.getSelfPeer(), data };
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
		const payload = { msgId: getPayloadMessageId(data), from: this.getSelfPeer(), data };
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

	private tryConnect(basePeerId: string) {
		if (!this.peer) return;
		if (this.connections.has(basePeerId)) return;
		if (this.peer.id === basePeerId) return;
		try {
			const conn = this.peer.connect(basePeerId, { reliable: true });
			this.handleConnection(conn);
		} catch {
			/* offline or unreachable peer */
		}
	}

	private connectKnownPeers(peers: ReadonlyArray<ChatUser>) {
		if (!this.peer || !this.roomId || !this.identity) return;

		const baseSelfId = `${this.roomId}_${this.identity.id}`;
		this.tryConnect(baseSelfId);

		for (const user of peers) {
			if (user.id === this.identity.id) continue;
			this.tryConnect(`${this.roomId}_${user.id}`);
		}
	}

	private handleIncoming(conn: DataConnection) {
		this.handleConnection(conn);
	}

	private handleConnection(conn: DataConnection) {
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
			const msg = raw as SignalWireMessage;
			const msgId = getWireMessageId(msg);

			if (msgId && this.receivedMsgIds.has(msgId)) return;
			if (msgId) {
				this.receivedMsgIds.add(msgId);
				this.forwardToOtherPeers(peerId, raw);
			}

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
				data: msg.data ?? msg,
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

	private forwardToOtherPeers(sourcePeerId: string, raw: unknown): void {
		for (const [targetPeerId, conn] of this.connections.entries()) {
			if (targetPeerId === sourcePeerId) continue;
			try {
				conn.send(raw);
			} catch {
				/* ignore */
			}
		}
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

const isUnavailablePeerId = (err: unknown): boolean => {
	const peerErr = err as PeerError;
	const message = peerErr?.message?.toLowerCase() ?? "";
	return (
		peerErr?.type === "unavailable-id" ||
		message.includes("unavailable-id") ||
		message.includes("is taken") ||
		message.includes("taken")
	);
};

const getPayloadMessageId = (data: unknown): string | undefined => {
	if (!data || typeof data !== "object") return undefined;
	const msgId = (data as { msgId?: unknown }).msgId;
	return typeof msgId === "string" ? msgId : undefined;
};

const getWireMessageId = (msg: SignalWireMessage): string | undefined =>
	typeof msg.msgId === "string" ? msg.msgId : getPayloadMessageId(msg.data);
