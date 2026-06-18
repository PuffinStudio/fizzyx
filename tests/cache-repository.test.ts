import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { expect, test } from "bun:test";
import { FileError } from "../src/domain/errors";
import type { BoardCache } from "../src/domain/models";
import { makeBunCacheRepository } from "../src/adapters/bun-cache-repository";

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fizzyx-cache-"));

const TEST_CACHE: BoardCache = {
	identity: {
		userId: "user-1",
		name: "Jane",
		email: "jane@example.com",
	},
	cards: [],
	notNow: [],
	columns: [],
	users: {},
	syncedAt: "2026-01-01T00:00:00.000Z",
};

test("cache is stored under HOME/.config/fizzyx/cache path", async () => {
	const root = makeTempDir();
	const home = join(root, "home");
	const originalHome = process.env.HOME;
	process.env.HOME = home;

	try {
		const repo = makeBunCacheRepository("account-1", "board-123");
		const path = join(home, ".config", "fizzyx", "cache", "account-1", "board-123", "board.json");

		expect(await Effect.runPromise(repo.read())).toBeNull();

		await Effect.runPromise(repo.write(TEST_CACHE));
		expect(existsSync(path)).toBe(true);

		const loaded = await Effect.runPromise(repo.read());
		expect(loaded).toEqual(TEST_CACHE);
		expect(await Effect.runPromise(repo.ageSeconds())).toBeLessThanOrEqual(5);
		expect(readFileSync(path, "utf8")).toContain('"syncedAt"');
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		rmSync(root, { recursive: true, force: true });
	}
});

test("cache operations require account, board, and HOME", async () => {
	const originalHome = process.env.HOME;
	delete process.env.HOME;

	try {
		let boardError: unknown;
		let accountError: unknown;
		let homeError: unknown;

		try {
			await Effect.runPromise(makeBunCacheRepository("account-1", "").read());
		} catch (error) {
			boardError = error;
		}

		try {
			await Effect.runPromise(makeBunCacheRepository("", "board-1").read());
		} catch (error) {
			accountError = error;
		}

		try {
			await Effect.runPromise(makeBunCacheRepository("account-1", "board-1").read());
		} catch (error) {
			homeError = error;
		}

		expect(boardError).toBeInstanceOf(FileError);
		expect(accountError).toBeInstanceOf(FileError);
		expect(homeError).toBeInstanceOf(FileError);
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
	}
});

test("cache path safely escapes board/account path separators", async () => {
	const root = makeTempDir();
	const home = join(root, "home");
	const originalHome = process.env.HOME;
	process.env.HOME = home;

	try {
		const repo = makeBunCacheRepository("ac/ct", "bo/ard");
		await Effect.runPromise(repo.write(TEST_CACHE));

		const expectedPath = join(home, ".config", "fizzyx", "cache", "ac_ct", "bo_ard", "board.json");
		expect(existsSync(expectedPath)).toBe(true);
	} finally {
		if (originalHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = originalHome;
		}
		rmSync(root, { recursive: true, force: true });
	}
});
