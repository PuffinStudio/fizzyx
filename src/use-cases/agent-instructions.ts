import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FlowCardLanguage } from "../domain/models";

export const AGENT_INSTRUCTIONS_FILE = "AGENTS.md";
export const AGENT_INSTRUCTIONS_START = "<!-- fizzyx:dev-workflow:start -->";
export const AGENT_INSTRUCTIONS_END = "<!-- fizzyx:dev-workflow:end -->";

export type AgentInstructionsAction = "created" | "updated" | "unchanged";

const CARD_LANGUAGE_NAMES: Record<FlowCardLanguage, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese (简体中文)",
};

export interface AgentInstructionsOptions {
  /** `flow.card.language`; adds the one line about the language of card content. */
  cardLanguage?: FlowCardLanguage;
}

/**
 * The section is read at the start of every agent session, so it holds only what an agent
 * must do differently because of FizzyX. Blank lines after the start marker and before the
 * end marker are what Markdown formatters produce anyway; without them every `fizzyx init`
 * and every format run undid each other.
 */
export const renderAgentInstructionsSection = (options: AgentInstructionsOptions = {}): string =>
  [
    AGENT_INSTRUCTIONS_START,
    "",
    "## FizzyX cards and branches",
    "",
    "- Work is done per card: one card per requirement, and its sub-tasks are the card's steps. Only the coordinating agent runs `fizzyx flow`; sub-agents never touch cards. `flow` prints compact text; add `--json` only to parse a field.",
    '- Start of a session: `fizzyx flow work --agent`, then `fizzyx flow show <card>` and `fizzyx flow start <card>`. New card: `fizzyx flow create "<title>" --desc -` with a `## Steps` task list on stdin.',
    "- Each sub-task gets its own worktree and branch: `fizzyx dev start <slug> --kind <fix|feature> --worktree --agent`, then work in the printed `worktree_path`, commit there and report the commit hashes. Never switch branches in the main checkout.",
    "- The coordinator integrates those commits onto the base branch, runs the project's checks, ticks the step with `fizzyx flow show <card> --check <n>`, and closes the card with `fizzyx flow done <card>` once every step is ticked.",
    "- `fizzyx dev doctor` reports branches whose commits are not on the base branch yet. Push, and delete branches or worktrees (`fizzyx dev cleanup --confirm-delete`), only when the user asks.",
    ...(options.cardLanguage
      ? [
          `- Write card titles, descriptions, steps and comments in ${CARD_LANGUAGE_NAMES[options.cardLanguage]}. Commands, code, commit messages and branch names are unaffected.`,
        ]
      : []),
    "",
    AGENT_INSTRUCTIONS_END,
  ].join("\n");

export const syncAgentInstructions = (
  rootDir: string,
  options: AgentInstructionsOptions = {},
): { action: AgentInstructionsAction; path: string } => {
  const section = renderAgentInstructionsSection(options);
  const path = join(rootDir, AGENT_INSTRUCTIONS_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, `${section}\n`, "utf8");
    return { action: "created", path };
  }

  const current = readFileSync(path, "utf8");
  const start = current.indexOf(AGENT_INSTRUCTIONS_START);
  const end = current.indexOf(AGENT_INSTRUCTIONS_END);
  let next: string;

  if (start >= 0 && end >= start) {
    const suffixStart = end + AGENT_INSTRUCTIONS_END.length;
    next = `${current.slice(0, start)}${section}${current.slice(suffixStart)}`;
  } else {
    const separator =
      current.length === 0
        ? ""
        : current.endsWith("\n\n")
          ? ""
          : current.endsWith("\n")
            ? "\n"
            : "\n\n";
    next = `${current}${separator}${section}\n`;
  }

  if (next === current) return { action: "unchanged", path };
  writeFileSync(path, next, "utf8");
  return { action: "updated", path };
};
