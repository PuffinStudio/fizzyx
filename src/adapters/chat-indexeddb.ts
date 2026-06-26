import type { ChatMessage } from "../domain/chat";
import { ChatStorageError } from "../domain/chat-errors";
import type { ChatStorage } from "../ports/chat-storage";

const DB_NAME = "fizzyx-chat";
const DB_VERSION = 3;
const STORE_NAME = "messages";
const META_STORE = "meta";

const openDB = (): Promise<IDBDatabase> =>
	new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (db.objectStoreNames.contains(STORE_NAME)) {
				db.deleteObjectStore(STORE_NAME);
			}
			const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
			store.createIndex("roomId", "roomId", { unique: false });
			store.createIndex("createdAt", "createdAt", { unique: false });
			store.createIndex("room_createdAt", ["roomId", "createdAt"], { unique: false });
			if (!db.objectStoreNames.contains(META_STORE)) {
				db.createObjectStore(META_STORE, { keyPath: "key" });
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(new ChatStorageError("Failed to open IndexedDB", req.error));
	});

const serialize = (msg: ChatMessage): unknown => ({
	...msg,
	createdAt: msg.createdAt,
});

const deserialize = (raw: Record<string, unknown>): ChatMessage => ({
	id: raw.id as string,
	roomId: raw.roomId as string,
	sender: raw.sender as ChatMessage["sender"],
	content: raw.content as string,
	type: raw.type as ChatMessage["type"],
	createdAt: raw.createdAt as string,
	encrypted: raw.encrypted as boolean,
	encryptedPayload: raw.encryptedPayload as ChatMessage["encryptedPayload"],
	replyTo: raw.replyTo as ChatMessage["replyTo"],
	encryptedReplyTo: raw.encryptedReplyTo as ChatMessage["encryptedReplyTo"],
});

export class IndexedDBChatStorage implements ChatStorage {
	private db: Promise<IDBDatabase>;

	constructor() {
		this.db = openDB();
	}

	async save(message: ChatMessage): Promise<void> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			tx.objectStore(STORE_NAME).put(serialize(message));
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(new ChatStorageError("Failed to save message", tx.error));
		});
	}

	async saveMany(messages: ChatMessage[]): Promise<void> {
		if (messages.length === 0) return;
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			for (const msg of messages) store.put(serialize(msg));
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(new ChatStorageError("Failed to save messages", tx.error));
		});
	}

	async getHistory(
		roomId: string,
		options?: { before?: string; limit?: number },
	): Promise<ChatMessage[]> {
		const db = await this.db;
		const limit = options?.limit ?? 50;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const index = tx.objectStore(STORE_NAME).index("room_createdAt");
			const range = IDBKeyRange.bound([roomId, ""], [roomId, options?.before ?? "Z"]);
			const results: ChatMessage[] = [];
			const req = index.openCursor(range, "prev");
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor && results.length < limit) {
					results.push(deserialize(cursor.value as Record<string, unknown>));
					cursor.continue();
				} else {
					resolve(results.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
				}
			};
			req.onerror = () => reject(new ChatStorageError("Failed to query history", req.error));
		});
	}

	async getLatestTimestamp(roomId: string): Promise<string | null> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const index = tx.objectStore(STORE_NAME).index("room_createdAt");
			const range = IDBKeyRange.bound([roomId, ""], [roomId, "Z"]);
			const req = index.openCursor(range, "prev");
			req.onsuccess = () => {
				const cursor = req.result;
				resolve(cursor ? (cursor.value as ChatMessage).createdAt : null);
			};
			req.onerror = () => reject(new ChatStorageError("Failed to get latest timestamp", req.error));
		});
	}

	async deleteOlderThan(roomId: string, timestamp: string): Promise<number> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const index = tx.objectStore(STORE_NAME).index("room_createdAt");
			const range = IDBKeyRange.bound([roomId, ""], [roomId, timestamp]);
			const req = index.openCursor(range);
			let count = 0;
			req.onsuccess = () => {
				const cursor = req.result;
				if (cursor) {
					cursor.delete();
					count++;
					cursor.continue();
				} else {
					resolve(count);
				}
			};
			req.onerror = () => reject(new ChatStorageError("Failed to delete old messages", req.error));
		});
	}

	async count(roomId: string): Promise<number> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const index = tx.objectStore(STORE_NAME).index("roomId");
			const req = index.count(roomId);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(new ChatStorageError("Failed to count messages", req.error));
		});
	}

	async getMeta<T>(key: string): Promise<T | null> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(META_STORE, "readonly");
			const req = tx.objectStore(META_STORE).get(key);
			req.onsuccess = () => resolve((req.result as { value: T } | undefined)?.value ?? null);
			req.onerror = () => reject(new ChatStorageError("Failed to read meta", req.error));
		});
	}

	async setMeta<T>(key: string, value: T): Promise<void> {
		const db = await this.db;
		return new Promise((resolve, reject) => {
			const tx = db.transaction(META_STORE, "readwrite");
			tx.objectStore(META_STORE).put({ key, value });
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(new ChatStorageError("Failed to write meta", tx.error));
		});
	}
}
