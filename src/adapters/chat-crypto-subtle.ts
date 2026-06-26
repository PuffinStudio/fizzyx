import { ChatCryptoError } from "../domain/chat-errors";
import type { CryptoService } from "../ports/chat-crypto";

import type { EncryptedPayload } from "../domain/chat";

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const ITERATIONS = 100_000;
const SALT = "fizzyx-chat-v1";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class SubtleCryptoService implements CryptoService {
	private key: CryptoKey | null = null;

	async deriveRoomKey(account: string, board: string): Promise<string> {
		const input = `${account}/${board}`;
		const hash = await crypto.subtle.digest("SHA-256", textEncoder.encode(input));
		const hex = Array.from(new Uint8Array(hash))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		return hex;
	}

	async init(roomKey: string): Promise<void> {
		const keyMaterial = await crypto.subtle.importKey(
			"raw",
			textEncoder.encode(roomKey),
			"PBKDF2",
			false,
			["deriveKey"],
		);

		this.key = await crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: textEncoder.encode(SALT),
				iterations: ITERATIONS,
				hash: "SHA-256",
			},
			keyMaterial,
			{ name: ALGORITHM, length: KEY_LENGTH },
			false,
			["encrypt", "decrypt"],
		);
	}

	async encrypt(plaintext: string): Promise<EncryptedPayload> {
		if (!this.key) throw new ChatCryptoError("CryptoService not initialized");

		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encoded = textEncoder.encode(plaintext);

		try {
			const ciphertext = await crypto.subtle.encrypt(
				{ name: ALGORITHM, iv: iv as unknown as BufferSource },
				this.key,
				Uint8Array.from(encoded) as unknown as BufferSource,
			);
			return {
				iv: bytesToBase64(iv),
				ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
			};
		} catch (cause) {
			throw new ChatCryptoError("Encryption failed", cause);
		}
	}

	async decrypt(payload: EncryptedPayload): Promise<string> {
		if (!this.key) throw new ChatCryptoError("CryptoService not initialized");

		try {
			const iv = base64ToBytes(payload.iv);
			const ciphertext = base64ToBytes(payload.ciphertext);
			const decrypted = await crypto.subtle.decrypt(
				{ name: ALGORITHM, iv: iv as unknown as BufferSource },
				this.key,
				Uint8Array.from(ciphertext) as unknown as BufferSource,
			);
			return textDecoder.decode(decrypted);
		} catch (cause) {
			throw new ChatCryptoError("Decryption failed", cause);
		}
	}
}

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
	return btoa(binary);
};

const base64ToBytes = (base64: string): Uint8Array => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
};
