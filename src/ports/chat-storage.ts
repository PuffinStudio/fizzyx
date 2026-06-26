import type { ChatMessage } from "../domain/chat";

export interface ChatStorage {
	save(message: ChatMessage): Promise<void>;
	saveMany(messages: ChatMessage[]): Promise<void>;
	getHistory(roomId: string, options?: { before?: string; limit?: number }): Promise<ChatMessage[]>;
	getLatestTimestamp(roomId: string): Promise<string | null>;
	deleteOlderThan(roomId: string, timestamp: string): Promise<number>;
	count(roomId: string): Promise<number>;
}
