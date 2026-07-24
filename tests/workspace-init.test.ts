import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
	renderWorkspaceSection,
	scanWorkspaceMembers,
	syncWorkspaceInstructions,
	WORKSPACE_INSTRUCTIONS_END,
	WORKSPACE_INSTRUCTIONS_START,
} from "../src/use-cases/workspace-instructions";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-workspace-"));

const makeMember = (root: string, name: string, config?: string): void => {
	const dir = join(root, name);
	mkdirSync(dir, { recursive: true });
	if (config !== undefined) writeFileSync(join(dir, ".fizzyx.yaml"), config, "utf8");
};

test("scanWorkspaceMembers detects configured folders and reads board ids", () => {
	const root = makeTempDir();
	try {
		makeMember(root, "api", "api_url: https://example.com\naccount: 1\nboard: board-42\n");
		makeMember(root, "web", "api_url: https://example.com\naccount: 1\nboard: board-17\n");
		makeMember(root, "mp"); // no config
		mkdirSync(join(root, "node_modules"), { recursive: true });
		mkdirSync(join(root, ".hidden"), { recursive: true });

		const members = scanWorkspaceMembers(root);
		const byName = Object.fromEntries(members.map((m) => [m.name, m]));

		expect(members.map((m) => m.name)).toEqual(["api", "mp", "web"]);
		expect(byName.api).toMatchObject({ configured: true, board: "board-42" });
		expect(byName.web).toMatchObject({ configured: true, board: "board-17" });
		expect(byName.mp).toMatchObject({ configured: false });
		expect(byName.node_modules).toBeUndefined();
		expect(byName[".hidden"]).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("renderWorkspaceSection marks configured vs unconfigured members", () => {
	const section = renderWorkspaceSection([
		{ name: "api", configured: true, board: "board-42" },
		{ name: "mp", configured: false },
	]);
	expect(section).toContain(WORKSPACE_INSTRUCTIONS_START);
	expect(section).toContain(WORKSPACE_INSTRUCTIONS_END);
	expect(section).toContain("api/ — fizzyx-configured (board board-42)");
	expect(section).toContain("mp/ — no .fizzyx.yaml");
});

test("syncWorkspaceInstructions creates, is idempotent, and preserves outside content", () => {
	const root = makeTempDir();
	try {
		const members = [
			{ name: "api", configured: true, board: "board-42" },
			{ name: "mp", configured: false },
		];

		const first = syncWorkspaceInstructions(root, members);
		expect(first.action).toBe("created");
		let content = readFileSync(first.path, "utf8");
		expect(content).toContain("api/ — fizzyx-configured (board board-42)");
		expect(content).toContain("mp/ — no .fizzyx.yaml");

		const second = syncWorkspaceInstructions(root, members);
		expect(second.action).toBe("unchanged");

		// Preserve content outside the markers on update.
		writeFileSync(first.path, `# Keep me\n\n${readFileSync(first.path, "utf8")}\nTrailing.\n`, "utf8");
		const third = syncWorkspaceInstructions(root, [{ name: "api", configured: true, board: "board-99" }]);
		expect(third.action).toBe("updated");
		content = readFileSync(third.path, "utf8");
		expect(content).toContain("# Keep me");
		expect(content).toContain("Trailing.");
		expect(content).toContain("board board-99");
		expect(content).not.toContain("board board-42");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("init --workspace writes root AGENTS.md with configured defaults (non-TTY)", async () => {
	const root = makeTempDir();
	try {
		makeMember(root, "api", "api_url: https://example.com\naccount: 1\nboard: board-42\n");
		makeMember(root, "web", "api_url: https://example.com\naccount: 1\nboard: board-17\n");
		makeMember(root, "mp");

		const projectRoot = join(import.meta.dir, "..");
		const entry = join(projectRoot, "src", "main.ts");
		const proc = Bun.spawn(["bun", "run", entry, "init", "--workspace"], {
			cwd: root,
			stdout: "pipe",
			stderr: "pipe",
			stdin: "ignore",
		});
		const [stdout, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("AGENTS.md");

		const content = readFileSync(join(root, "AGENTS.md"), "utf8");
		expect(content).toContain(WORKSPACE_INSTRUCTIONS_START);
		expect(content).toContain("api/ — fizzyx-configured (board board-42)");
		expect(content).toContain("web/ — fizzyx-configured (board board-17)");
		// Non-TTY fallback keeps configured defaults; unconfigured folder is not selected.
		expect(content).not.toContain("mp/");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
