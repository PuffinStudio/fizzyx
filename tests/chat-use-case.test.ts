import { expect, test } from "bun:test";
import { createChatUseCase } from "../src/use-cases/chat";
import type { ChatUser } from "../src/domain/chat";
import type { CryptoService, SignalProvider, SignalServerConfig, ChatStorage } from "../src/ports";

const makeCrypto = (): CryptoService => ({
	init: async () => {},
	encrypt: async (plaintext) => ({ iv: "iv", ciphertext: plaintext }),
	decrypt: async (payload) => payload.ciphertext,
	deriveRoomKey: async () => "room-key-for-team",
});

const makeStorage = (): ChatStorage => ({
	save: async () => {},
	saveMany: async () => {},
	getHistory: async () => [],
	getLatestTimestamp: async () => null,
	deleteOlderThan: async () => 0,
	count: async () => 0,
});

const makeSignalProvider = () => {
	let onMessage:
		| ((event: Parameters<Parameters<SignalProvider["onMessage"]>[0]>[0]) => void)
		| null = null;
	const sent: unknown[] = [];
	const provider: SignalProvider = {
		connect: async () => {},
		disconnect: () => {},
		send: (data) => sent.push(data),
		sendTo: () => {},
		getPeers: () => [],
		onMessage: (handler) => {
			onMessage = handler;
		},
		onPeerJoin: () => {},
		onPeerLeave: () => {},
		onConnectionStateChange: () => {},
	};
	return {
		provider,
		sent,
		emit: (event: Parameters<Parameters<SignalProvider["onMessage"]>[0]>[0]) => {
			onMessage?.(event);
		},
	};
};

test("chat connect passes known team members to the signal provider", async () => {
	const identity: ChatUser = { id: "me", name: "Me" };
	const members: ChatUser[] = [
		identity,
		{ id: "ada", name: "Ada" },
		{ id: "linus", name: "Linus" },
	];
	const connectCalls: Array<{
		roomId: string;
		identity: ChatUser;
		peers?: ReadonlyArray<ChatUser>;
	}> = [];

	const signalProvider: SignalProvider = {
		connect: async (
			roomId: string,
			user: ChatUser,
			_signalServer?: SignalServerConfig,
			peers?: ReadonlyArray<ChatUser>,
		) => {
			connectCalls.push({ roomId, identity: user, peers });
		},
		disconnect: () => {},
		send: () => {},
		sendTo: () => {},
		getPeers: () => [],
		onMessage: () => {},
		onPeerJoin: () => {},
		onPeerLeave: () => {},
		onConnectionStateChange: () => {},
	};

	const chat = createChatUseCase({
		account: "1",
		board: "board-1",
		identity,
		members,
		signalProvider,
		cryptoService: makeCrypto(),
		storage: makeStorage(),
	});

	await chat.connect();

	expect(connectCalls).toEqual([
		{
			roomId: "room-key-for-tea",
			identity,
			peers: members,
		},
	]);
});

test("saved message sends over the shared signal provider with self scope", async () => {
	const identity: ChatUser = { id: "me", name: "Me" };
	const signal = makeSignalProvider();
	const selfMessages: string[] = [];

	const chat = createChatUseCase({
		account: "1",
		board: "board-1",
		identity,
		signalProvider: signal.provider,
		cryptoService: makeCrypto(),
		selfCryptoService: makeCrypto(),
		selfRoomKey: "self-key-for-me",
		storage: makeStorage(),
	});
	chat.onSelfMessage((msg) => selfMessages.push(msg.content));

	await chat.connect();
	await chat.sendSelfText("save this");

	expect(signal.sent).toHaveLength(1);
	expect(signal.sent[0]).toMatchObject({
		type: "chat",
		scope: "self",
		msgType: "text",
		encrypted: { ciphertext: "save this" },
	});
	expect(selfMessages).toEqual(["save this"]);
});

test("saved messages require a separate self encryption key", async () => {
	const identity: ChatUser = { id: "me", name: "Me" };
	const signal = makeSignalProvider();

	const chat = createChatUseCase({
		account: "1",
		board: "board-1",
		identity,
		signalProvider: signal.provider,
		cryptoService: makeCrypto(),
		storage: makeStorage(),
	});

	await chat.connect();

	await expect(chat.sendSelfText("private")).rejects.toThrow("Saved messages are not available");
	expect(signal.sent).toHaveLength(0);
});

test("incoming self-scoped messages are only accepted from the same user", async () => {
	const identity: ChatUser = { id: "me", name: "Me" };
	const signal = makeSignalProvider();
	const selfMessages: string[] = [];
	const teamMessages: string[] = [];

	const chat = createChatUseCase({
		account: "1",
		board: "board-1",
		identity,
		signalProvider: signal.provider,
		cryptoService: makeCrypto(),
		selfCryptoService: makeCrypto(),
		selfRoomKey: "self-key-for-me",
		storage: makeStorage(),
	});
	chat.onSelfMessage((msg) => selfMessages.push(msg.content));
	chat.onMessage((msg) => teamMessages.push(msg.content));

	await chat.connect();
	signal.emit({
		from: { peerId: "same-device", user: identity },
		data: {
			type: "chat",
			scope: "self",
			msgId: "same-user-msg",
			msgType: "text",
			encrypted: { iv: "iv", ciphertext: "from my laptop" },
			createdAt: new Date().toISOString(),
		},
	});
	signal.emit({
		from: { peerId: "other-device", user: { id: "ada", name: "Ada" } },
		data: {
			type: "chat",
			scope: "self",
			msgId: "other-user-msg",
			msgType: "text",
			encrypted: { iv: "iv", ciphertext: "not mine" },
			createdAt: new Date().toISOString(),
		},
	});

	await Promise.resolve();
	await Promise.resolve();

	expect(selfMessages).toEqual(["from my laptop"]);
	expect(teamMessages).toEqual([]);
});
