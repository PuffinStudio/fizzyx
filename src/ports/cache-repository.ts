import { Context, type Effect } from "effect";
import type { FileError } from "../domain/errors";
import type { BoardCache } from "../domain/models";

export interface CacheRepository {
	read: () => Effect.Effect<BoardCache | null, FileError>;
	write: (cache: BoardCache) => Effect.Effect<void, FileError>;
	ageSeconds: () => Effect.Effect<number, FileError>;
}

export const CacheRepo = Context.Service<CacheRepository>("CacheRepo");
