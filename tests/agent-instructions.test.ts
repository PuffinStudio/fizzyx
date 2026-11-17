import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_INSTRUCTIONS_END,
  AGENT_INSTRUCTIONS_START,
  syncAgentInstructions,
} from "../src/use-cases/agent-instructions";

const makeRoot = () => mkdtempSync(join(tmpdir(), "fizzyx-agents-"));

test("creates AGENTS.md with the FizzyX workflow", () => {
  const root = makeRoot();
  try {
    const result = syncAgentInstructions(root);
    const content = readFileSync(join(root, "AGENTS.md"), "utf8");

    expect(result.action).toBe("created");
    expect(content).toContain(AGENT_INSTRUCTIONS_START);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("preserves existing instructions and updates the marked section without duplication", () => {
  const root = makeRoot();
  const path = join(root, "AGENTS.md");
  try {
    writeFileSync(
      path,
      `# Project instructions\n\nKeep this text.\n\n${AGENT_INSTRUCTIONS_START}\nold workflow\n${AGENT_INSTRUCTIONS_END}\n\n## Local rules\n\nKeep this too.\n`,
    );

    const first = syncAgentInstructions(root);
    const second = syncAgentInstructions(root);
    const content = readFileSync(path, "utf8");

    expect(first.action).toBe("updated");
    expect(second.action).toBe("unchanged");
    expect(content).toContain("Keep this text.");
    expect(content).toContain("Keep this too.");
    expect(content.match(new RegExp(AGENT_INSTRUCTIONS_START, "g"))).toHaveLength(1);
    expect(content.match(new RegExp(AGENT_INSTRUCTIONS_END, "g"))).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appends the FizzyX workflow to an unmarked AGENTS.md", () => {
  const root = makeRoot();
  const path = join(root, "AGENTS.md");
  try {
    writeFileSync(path, "# Existing agent rules\n");

    const result = syncAgentInstructions(root);
    const content = readFileSync(path, "utf8");

    expect(result.action).toBe("updated");
    expect(content).toStartWith("# Existing agent rules\n\n");
    expect(content).toContain(AGENT_INSTRUCTIONS_START);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const bullets = (text: string) => text.split("\n").filter((line) => line.startsWith("- "));

test("adds the card-language instruction only when a language is configured", () => {
  const root = makeRoot();
  const path = join(root, "AGENTS.md");
  try {
    syncAgentInstructions(root);
    const without = bullets(readFileSync(path, "utf8"));

    const result = syncAgentInstructions(root, { cardLanguage: "zh-CN" });
    const withLanguage = bullets(readFileSync(path, "utf8"));

    expect(result.action).toBe("updated");
    expect(withLanguage.slice(0, without.length)).toEqual(without);
    expect(withLanguage).toHaveLength(without.length + 1);
    expect(withLanguage.at(-1)).toContain("简体中文");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("blank lines inside the markers survive, so a formatter and the next sync agree", () => {
  const root = makeRoot();
  const path = join(root, "AGENTS.md");
  try {
    syncAgentInstructions(root);
    const lines = readFileSync(path, "utf8").split("\n");

    expect(lines[lines.indexOf(AGENT_INSTRUCTIONS_START) + 1]).toBe("");
    expect(lines[lines.indexOf(AGENT_INSTRUCTIONS_END) - 1]).toBe("");
    expect(syncAgentInstructions(root).action).toBe("unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
