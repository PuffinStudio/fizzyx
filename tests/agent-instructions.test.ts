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
		expect(content).toContain("fizzyx dev status --agent");
		expect(content).toContain("fizzyx flow move");
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
