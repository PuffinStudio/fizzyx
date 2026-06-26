import type { EncryptedPayload } from "../domain/chat";

export interface CryptoService {
	init(roomKey: string): Promise<void>;
	encrypt(plaintext: string): Promise<EncryptedPayload>;
	decrypt(payload: EncryptedPayload): Promise<string>;
	deriveRoomKey(account: string, board: string): Promise<string>;
}
