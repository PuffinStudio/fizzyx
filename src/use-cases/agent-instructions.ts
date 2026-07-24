import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
export const AGENT_INSTRUCTIONS_START = "<!-- fizzyx:dev-workflow:start -->";
export const AGENT_INSTRUCTIONS_END = "<!-- fizzyx:dev-workflow:end -->";

export type AgentInstructionsAction = "created" | "updated" | "unchanged";

export const AGENT_INSTRUCTIONS_SECTION = [
	AGENT_INSTRUCTIONS_START,
	"## FizzyX development workflow",
	"",
	"- Read this section before card-backed development. If `.agents/skills/dev-workflow/SKILL.md` exists, read it for the complete workflow.",
	"- If `.agents/skills/coding-standards/SKILL.md` exists, apply it while implementing or reviewing code.",
	"- Use `fizzyx flow` for remote Fizzy card and board state. Use `fizzyx dev` for local Git branches, checks, promotion, and cleanup.",
	"- Start by running `fizzyx flow work` (or `fizzyx flow show <card>`) and `fizzyx dev status --agent`.",
	"- Treat the initial dirty files as user-owned. Run `fizzyx dev baseline accept` only after inspecting them.",
	"- Start local work with `fizzyx dev start <slug> --kind <kind> --card <number>`, then move the remote card with `fizzyx flow start <number>`.",
	"- Default to branching in place. Add `--worktree` to `fizzyx dev start` only for parallel or long-running work (concurrent cards/agents, keeping another branch checked out); then `cd` into the reported worktree path.",
	"- Board columns are project-defined. Inspect them with `fizzyx flow columns` and use `fizzyx flow move <card> <column-id-or-name>` for custom transitions. `flow review` is only a convenience for boards using the bundled REVIEW preset.",
	"- Before reporting completion, run `fizzyx dev ready --agent`. Use `fizzyx flow done <card> <ref>` only after the required checks and deliverable reference exist.",
	"- Use `fizzyx dev sync`; do not merge protected or aggregate branches by hand. Production promotion requires a dry run and explicit confirmation.",
	"- Run `fizzyx dev cleanup` to preview cleanup. Never pass `--confirm-delete` or delete a remote branch unless the user explicitly requests it.",
	AGENT_INSTRUCTIONS_END,
].join("\n");

export const syncAgentInstructions = (
	rootDir: string,
): { action: AgentInstructionsAction; path: string } => {
	const path = join(rootDir, AGENT_INSTRUCTIONS_FILE);
	if (!existsSync(path)) {
		writeFileSync(path, `${AGENT_INSTRUCTIONS_SECTION}\n`, "utf8");
		return { action: "created", path };
	}

	const current = readFileSync(path, "utf8");
	const start = current.indexOf(AGENT_INSTRUCTIONS_START);
	const end = current.indexOf(AGENT_INSTRUCTIONS_END);
	let next: string;

	if (start >= 0 && end >= start) {
		const suffixStart = end + AGENT_INSTRUCTIONS_END.length;
		next = `${current.slice(0, start)}${AGENT_INSTRUCTIONS_SECTION}${current.slice(suffixStart)}`;
	} else {
		const separator =
			current.length === 0
				? ""
				: current.endsWith("\n\n")
					? ""
					: current.endsWith("\n")
						? "\n"
						: "\n\n";
		next = `${current}${separator}${AGENT_INSTRUCTIONS_SECTION}\n`;
	}

	if (next === current) return { action: "unchanged", path };
	writeFileSync(path, next, "utf8");
	return { action: "updated", path };
};
