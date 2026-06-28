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
