import { expect, test } from "bun:test";
import type { Card, Comment } from "../src/domain/models";
import { printCardDetail, renderTable } from "../src/cli/render";

const ansiEscapeRegex = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");

const stripAnsiByConstructedRegex = (value: string): string => value.replace(ansiEscapeRegex, "");

test("printCardDetail renders markdown-like detail output", () => {
	const card: Card = {
		id: "card-123",
		number: 123,
		title: "Render card",
		description: "First line\nSecond line",
		closed: false,
		column: { name: "TODO" },
		assignees: [{ id: "u1", name: "Ray" }],
		steps: [
			{ content: "add tests", completed: true },
			{ content: "update docs", completed: false },
		],
	};

	const comments: ReadonlyArray<Comment> = [
		{
			created_at: "2026-01-02T10:00:00Z",
			creator: { name: "Bot" },
			body: { plain_text: "Implemented update" },
		},
	];

	const result = printCardDetail(card, comments);

	expect(result).toContain("# #123 Render card");
	expect(result).toContain("- column: TODO");
	expect(result).toContain("- assignees: Ray");
	expect(result).toContain("- closed: false");
	expect(result).toContain("## Description");
	expect(result).toContain("First line");
	expect(result).toContain("## Steps");
	expect(result).toContain("- [x] add tests");
	expect(result).toContain("- [ ] update docs");
	expect(result).toContain("## Last comments");
	expect(result).toContain("- 2026-01-02 Bot: Implemented update");
});

test("renderTable keeps width stable with ANSI and wide characters", () => {
	const ansiRed = Bun.color("red", "ansi") || "";
	const ansiReset = "\x1b[0m";

	const rows = [
		{ id: "1", title: "宽" },
		{ id: "22", title: `${ansiRed}宽${ansiReset}` },
	];

	const plain = renderTable(
		rows,
		[
			{ header: "id", value: (row) => row.id },
			{ header: "title", value: (row) => row.title.replace(ansiEscapeRegex, "") },
		],
		{ showHeader: true },
	);

	const ansi = renderTable(
		rows,
		[
			{ header: "id", value: (row) => row.id },
			{ header: "title", value: (row) => row.title },
		],
		{ showHeader: true },
	);

	expect(stripAnsiByConstructedRegex(ansi)).toBe(plain);
});
