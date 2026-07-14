import type { Card, Comment, Step } from "../domain/models";
import { markdownishText } from "../use-cases/flow-card-content";
import { parsePlannerDescription } from "../use-cases/planner-metadata";

export type RenderColumn<T> = {
	header: string;
	value: (row: T) => string;
	align?: "left" | "right";
};

type RenderTableOptions = {
	gap?: number;
	showHeader?: boolean;
	formatHeader?: (value: string) => string;
	formatValue?: <T>(value: string, row: T) => string;
};

const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*m`, "g");
const ANSI_RESET = "\x1b[0m";

const isColorAllowed = (): boolean => {
	if (typeof Bun?.color !== "function") return false;
	if (process.env.NO_COLOR) return false;
	if (process.env.CI && process.env.CI !== "false") return false;
	return Boolean(process.stdout?.isTTY);
};

const stripAnsi = (value: string): string => value.replace(ANSI_ESCAPE, "");

const visibleWidth = (value: string): number => Math.max(0, Bun.stringWidth(stripAnsi(value)));

export const colorize = (text: string, color: string): string => {
	if (!isColorAllowed()) return text;

	const start = Bun.color(color, "ansi");
	if (!start) return text;

	return `${start}${text}${ANSI_RESET}`;
};

export const renderTable = <T>(
	rows: ReadonlyArray<T>,
	columns: ReadonlyArray<RenderColumn<T>>,
	options: RenderTableOptions = {},
): string => {
	if (rows.length === 0) return "(none)";

	const gap = " ".repeat(Math.max(0, options.gap ?? 2));
	const showHeader = options.showHeader ?? false;

	const values = rows.map((row) => columns.map((column) => column.value(row)));
	const headerValues = columns.map((column) => column.header);

	const widths = columns.map((column, index) => {
		const columnHeaderWidth = visibleWidth(headerValues[index] || "");
		const rowWidth = values.reduce((max, cells) => {
			return Math.max(max, visibleWidth(cells[index] || ""));
		}, 0);
		return Math.max(columnHeaderWidth, rowWidth);
	});

	const formatCell = (
		value: string,
		width: number,
		align: RenderColumn<T>["align"] = "left",
	): string => {
		const needed = Math.max(0, width - visibleWidth(value));
		return align === "right" ? " ".repeat(needed) + value : `${value}${" ".repeat(needed)}`;
	};

	const lines: string[] = [];
	if (showHeader) {
		const headerLine = columns
			.map((column, index) =>
				formatCell(
					options.formatHeader ? options.formatHeader(column.header) : column.header,
					widths[index] ?? 0,
					"left",
				),
			)
			.join(gap);
		lines.push(headerLine);
	}

	for (const [rowIndex, rowValues] of values.entries()) {
		const row = rows[rowIndex];
		const line = rowValues
			.map((cell) => (options.formatValue ? options.formatValue(cell, row) : cell))
			.map((cell, index) => formatCell(cell, widths[index] ?? 0, columns[index]?.align))
			.join(gap);
		lines.push(line);
	}

	return lines.join("\n");
};

export const renderKv = (
	entries: ReadonlyArray<[string, string]>,
	options: { align?: boolean; bullet?: string } = {},
): string => {
	if (entries.length === 0) return "";
	const bullet = options.bullet || "-";
	const align = options.align ?? false;

	const labelWidth = align ? Math.max(...entries.map(([label]) => label.length), 0) : 0;

	return entries
		.map(([label, value]) => `${bullet} ${align ? label.padEnd(labelWidth) : label}: ${value}`)
		.join("\n");
};

export const printCards = (
	cards: ReadonlyArray<Card>,
	options: { systemColumn?: string } = {},
): string => {
	if (cards.length === 0) return "(none)";

	const table = renderTable(
		cards,
		[
			{ header: "column", value: (card) => columnName(card, options.systemColumn), align: "left" },
			{ header: "id", value: (card) => colorize(`#${card.number}`, "cyan") },
			{ header: "assignees", value: assignees },
			{ header: "title", value: (card) => card.title },
		],
		{
			gap: 2,
		},
	);

	return table;
};

export const printCardDetail = (card: Card, comments: ReadonlyArray<Comment>): string => {
	const steps = card.steps ?? [];
	const sourceDescription = card.descriptionHtml || card.description || "";
	const parsedDescription = parsePlannerDescription(sourceDescription);
	const lines: string[] = [
		`# #${card.number} ${card.title}`,
		"",
		renderKv([
			["column", columnName(card)],
			["assignees", assignees(card)],
			["closed", `${Boolean(card.closed)}`],
		]),
		"",
		"## Description",
		...(parsedDescription.body || sourceDescription
			? renderMarkdownText(parsedDescription.body)
			: ["(no description)"]),
	];

	if (steps.length > 0) {
		lines.push(
			"",
			"## Steps",
			...steps.map((step) => `- ${step.completed ? "[x]" : "[ ]"} ${step.content}`),
		);
	}

	if (comments.length > 0) {
		lines.push("", "## Last comments");
		for (const comment of comments) {
			const creator = comment.creator?.name || "?";
			const body = (comment.body?.plain_text || "").replace(/\n+/g, " / ").trim() || "(no content)";
			lines.push(`- ${date(comment.created_at)} ${creator}: ${body}`);
		}
	}

	return lines.join("\n");
};

export const printSteps = (steps: ReadonlyArray<Pick<Step, "content" | "completed">>): string => {
	if (steps.length === 0) return "no new steps";
	return steps.map((step) => `  + ${step.completed ? "[x]" : "[ ]"} ${step.content}`).join("\n");
};

export const buildKeyTree = (objects: { key: string; size?: number }[]): string[] => {
	const formatSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	type Entry = { size?: number; children: Record<string, Entry> };
	const root: Entry = { children: {} };
	for (const obj of objects) {
		const parts = obj.key.split("/");
		let node = root;
		for (const part of parts) {
			if (part === "") continue;
			if (!node.children[part]) node.children[part] = { children: {} };
			node = node.children[part] as Entry;
		}
		node.size = obj.size;
	}

	const lines: string[] = [];
	const walk = (entry: Entry, prefix: string, names: string[]) => {
		for (let i = 0; i < names.length; i++) {
			const name = names[i] as string;
			const child = entry.children[name] as Entry | undefined;
			if (!child) continue;
			const childNames = Object.keys(child.children);
			const last = i === names.length - 1;
			const indent = prefix + (last ? "    " : "│   ");
			const sizeLabel = child.size !== undefined ? `  ${formatSize(child.size)}` : "";
			lines.push(
				`${prefix}${last ? "└── " : "├── "}${name}${childNames.length > 0 ? "/" : ""}${sizeLabel}`,
			);
			if (childNames.length > 0) {
				walk(child, indent, childNames);
			}
		}
	};

	walk(root, "", Object.keys(root.children));
	return lines;
};

const columnName = (card: Card, systemColumn?: string): string => {
	if (systemColumn) return systemColumn;
	if (card.closed) return "DONE";
	if (card.postponed) return "NOT_NOW";
	return card.column?.name || "MAYBE";
};

const assignees = (card: Card): string => {
	const names = (card.assignees || []).map((assignee) => assignee.name).filter(Boolean);
	return names.length === 0 ? "-" : names.join(", ");
};

const date = (value: string | undefined): string => (value ? value.replace(/T.*/, "") : "?");

const renderMarkdownText = (text: string): string[] => {
	const normalized = markdownishText(text).trim();
	if (!normalized) {
		return ["(no description)"];
	}
	return normalized.split("\n");
};
