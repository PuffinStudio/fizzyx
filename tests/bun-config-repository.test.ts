import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
