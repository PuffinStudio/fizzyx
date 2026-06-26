export type ChatMessageType = "text" | "image" | "system";

export type ChatConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ChatUser {
	readonly id: string;
	readonly name: string;
	readonly avatarUrl?: string;
}

export interface MessageReplyRef {
	readonly id: string;
	readonly content: string;
	readonly sender: Pick<ChatUser, "id" | "name">;
}

export interface ChatMessage {
	readonly id: string;
	readonly roomId: string;
	readonly sender: ChatUser;
	readonly content: string;
	readonly type: ChatMessageType;
	readonly createdAt: string;
	readonly encrypted: boolean;
	readonly encryptedPayload?: EncryptedPayload;
	readonly replyTo?: MessageReplyRef;
	readonly encryptedReplyTo?: EncryptedPayload;
}

export interface EncryptedPayload {
	readonly iv: string;
	readonly ciphertext: string;
}

export const decryptMessage = async (
	msg: ChatMessage,
	crypto: { decrypt: (payload: EncryptedPayload) => Promise<string> },
): Promise<ChatMessage> => {
	if (!msg.encrypted || !msg.encryptedPayload || msg.content) return msg;
	try {
		const decrypted = await crypto.decrypt(msg.encryptedPayload);
		let replyTo: MessageReplyRef | undefined;
		if (msg.encryptedReplyTo) {
			try {
				const decryptedReply = await crypto.decrypt(msg.encryptedReplyTo);
				replyTo = JSON.parse(decryptedReply) as MessageReplyRef;
			} catch {
				// reply metadata unrecoverable, skip
			}
		}
		return { ...msg, content: decrypted, replyTo };
	} catch {
		return { ...msg, content: "[decryption failed]" };
	}
};

export const deriveRoomId = (account: string, board: string): string => {
	const input = `${account}/${board}`;
	let hash = 0;
	for (let i = 0; i < input.length; i++) {
		const chr = input.charCodeAt(i);
		hash = (hash << 5) - hash + chr;
		hash |= 0;
	}
	return hash.toString(36);
};

export const MAX_MESSAGE_LENGTH = 5000;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
export const HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const HISTORY_MAX_MESSAGES = 1000;
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
