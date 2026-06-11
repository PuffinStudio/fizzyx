import { Effect } from "effect";
import { FileError } from "../domain/errors";
import type { BoardCache } from "../domain/models";
import type { CacheRepository } from "../ports/cache-repository";

const CACHE_ROOT = ".config/fizzyx/cache";

export const makeBunCacheRepository = (account: string, board: string): CacheRepository => {
	const resolvePath = () =>
		Effect.sync(() => {
			const home = process.env.HOME;
			if (!home) {
				throw new FileError({ message: "HOME is not set" });
			}

			if (!account) {
				throw new FileError({ message: "cache requires account" });
			}

			if (!board) {
				throw new FileError({ message: "cache requires board. Run: fizzyx setup <board-id>" });
			}

			const safeAccount = safePathSegment(account);
			const safeBoard = safePathSegment(board);
			return `${home}/${CACHE_ROOT}/${safeAccount}/${safeBoard}/board.json`;
		});

	const resolveDir = (path: string): string => {
		const index = path.lastIndexOf("/");
		return index <= 0 ? "/" : path.slice(0, index);
	};

	return {
		read: () =>
			resolvePath().pipe(
				Effect.flatMap((path) =>
					Effect.tryPromise({
						try: async () => {
							const file = Bun.file(path);
							if (!(await file.exists())) return null;
							return JSON.parse(await file.text()) as BoardCache;
						},
						catch: (cause) =>
							new FileError({ message: `Failed to read cache: ${String(cause)}`, path }),
					}),
				),
			),
		write: (cache) =>
			resolvePath().pipe(
				Effect.flatMap((path) =>
					Effect.tryPromise({
						try: async () => {
							const dir = resolveDir(path);
							await import("node:fs/promises").then((fs) => fs.mkdir(dir, { recursive: true }));
							await Bun.write(path, `${JSON.stringify(cache, null, 2)}\n`);
						},
						catch: (cause) =>
							new FileError({ message: `Failed to write cache: ${String(cause)}`, path }),
					}),
				),
			),
		ageSeconds: () =>
			resolvePath().pipe(
				Effect.flatMap((path) =>
					Effect.tryPromise({
						try: async () => {
							const fs = await import("node:fs/promises");
							try {
								const stat = await fs.stat(path);
								return Math.max(0, Math.floor((Date.now() - stat.mtimeMs) / 1000));
							} catch {
								return Number.MAX_SAFE_INTEGER;
							}
						},
						catch: (cause) =>
							new FileError({ message: `Failed to stat cache: ${String(cause)}`, path }),
					}),
				),
			),
	};
};

const safePathSegment = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
