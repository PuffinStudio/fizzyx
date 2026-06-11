import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeBunConfigRepository } from "../src/adapters/bun-config-repository";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-repo-"));

const expectNoTrailingWhitespace = (text: string) => {
	expect(text.split("\n").every((line) => line === line.trimEnd())).toBe(true);
};

test("setupProjectConfig renders empty users map inline", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expectNoTrailingWhitespace(text);
		expect(text).toContain("users: {}");
		expect(text).not.toContain("users: \n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig writes non-empty object as block mapping", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {
					Alice: "alice-id",
					Bob: "bob-id",
				},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expectNoTrailingWhitespace(text);
		expect(text).toContain("users:");
		expect(text).toContain("  columns:\n    todo: todo-id");
		expect(text).toContain("  users:\n    Alice: alice-id");
		expect(text).not.toContain("  columns: \n");
		expect(text).not.toContain("  users: \n");
		expect(text).toContain("  Alice: alice-id");
		expect(text).toContain("  Bob: bob-id");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig writes flow card language", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("card:");
		expect(text).toContain("  language: zh-CN");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig preserves existing card language", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  card:
    language: en
  wip_limit: 10
  cache_ttl: 1200
`,
		);

		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("card:");
		expect(text).toContain("  language: en");
		expect(text).not.toContain("  language: zh-CN");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig falls back to Chinese card language when absent", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);

		const text = `api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
`;
		writeFileSync(configPath, text);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.flow).toBeDefined();
		expect(config.flow!.card.language).toBe("zh-CN");
		expect(config.flow!.wipLimit).toBe(5);
		expect(config.flow!.cacheTtlSeconds).toBe(900);
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig falls back to Chinese for invalid card language", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);

		const text = `api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  card:
    language: jp
`;
		writeFileSync(configPath, text);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.flow).toBeDefined();
		expect(config.flow!.card.language).toBe("zh-CN");
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});
