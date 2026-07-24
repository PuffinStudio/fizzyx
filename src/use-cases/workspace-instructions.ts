import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseProjectConfig } from "../adapters/config-codec";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";

export const WORKSPACE_INSTRUCTIONS_FILE = "AGENTS.md";
export const WORKSPACE_INSTRUCTIONS_START = "<!-- fizzyx:workspace:start -->";
export const WORKSPACE_INSTRUCTIONS_END = "<!-- fizzyx:workspace:end -->";

const IGNORED_DIRECTORIES = new Set([
	"node_modules",
	"dist",
	"build",
	"coverage",
	".git",
]);

export type WorkspaceInstructionsAction = "created" | "updated" | "unchanged";

export interface WorkspaceMember {
	name: string;
	configured: boolean;
	board?: string;
}

const readMemberConfig = (dir: string): { configured: boolean; board?: string } => {
	for (const file of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
		const configPath = join(dir, file);
		if (!existsSync(configPath)) continue;
		try {
			const parsed = parseProjectConfig(readFileSync(configPath, "utf8"), configPath, dir);
			return { configured: true, board: parsed.board };
		} catch {
			// A malformed config still means the folder is fizzyx-managed; list it without a board.
			return { configured: true };
		}
	}
	return { configured: false };
};

/**
 * Scan the immediate subdirectories of `rootDir` and report which of them carry a
 * fizzyx config. Pure filesystem read — no prompts — so it is unit-testable.
 */
export const scanWorkspaceMembers = (rootDir: string): ReadonlyArray<WorkspaceMember> => {
	const entries = readdirSync(rootDir, { withFileTypes: true });
	const members: WorkspaceMember[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) continue;
		const { configured, board } = readMemberConfig(join(rootDir, entry.name));
		members.push({ name: entry.name, configured, board });
	}
	return members.sort((a, b) => a.name.localeCompare(b.name));
};

const renderMemberLine = (member: WorkspaceMember): string => {
	if (!member.configured) {
		return `- ${member.name}/ — no ${CONFIG_FILE}; treat as a plain folder`;
	}
	const boardPart = member.board ? ` (board ${member.board})` : "";
	return `- ${member.name}/ — fizzyx-configured${boardPart}; read ${member.name}/AGENTS.md before editing`;
};

export const renderWorkspaceSection = (members: ReadonlyArray<WorkspaceMember>): string => {
	const lines = [
		WORKSPACE_INSTRUCTIONS_START,
		"## FizzyX workspace",
		"",
		"This folder groups multiple projects. When a change spans projects, apply it in each",
		"member and run that member's own `fizzyx dev` flow. Read each member's AGENTS.md before",
		"editing it.",
		"",
		...members.map(renderMemberLine),
		WORKSPACE_INSTRUCTIONS_END,
	];
	return lines.join("\n");
};

/**
 * Write or update the marker-delimited workspace section in the root AGENTS.md,
 * preserving everything outside the markers. Mirrors syncAgentInstructions.
 */
export const syncWorkspaceInstructions = (
	rootDir: string,
	members: ReadonlyArray<WorkspaceMember>,
): { action: WorkspaceInstructionsAction; path: string } => {
	const path = join(rootDir, WORKSPACE_INSTRUCTIONS_FILE);
	const section = renderWorkspaceSection(members);

	if (!existsSync(path)) {
		writeFileSync(path, `${section}\n`, "utf8");
		return { action: "created", path };
	}

	const current = readFileSync(path, "utf8");
	const start = current.indexOf(WORKSPACE_INSTRUCTIONS_START);
	const end = current.indexOf(WORKSPACE_INSTRUCTIONS_END);
	let next: string;

	if (start >= 0 && end >= start) {
		const suffixStart = end + WORKSPACE_INSTRUCTIONS_END.length;
		next = `${current.slice(0, start)}${section}${current.slice(suffixStart)}`;
	} else {
		const separator = current.length === 0 ? "" : current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
		next = `${current}${separator}${section}\n`;
	}

	if (next === current) return { action: "unchanged", path };
	writeFileSync(path, next, "utf8");
	return { action: "updated", path };
};
