import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const ansiEscape = String.fromCharCode(27);
const ansiCsiPattern = new RegExp(`${ansiEscape}\\[[0-9;]*[a-zA-Z]`, "g");
const ansiOscPattern = new RegExp(`${ansiEscape}\\]`, "g");
const stripAnsi = (s: string): string => s.replace(ansiCsiPattern, "").replace(ansiOscPattern, "");

const runCli = async (
	args: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<CliResult> => {
	const projectRoot = join(import.meta.dir, "..");
	const entry = join(projectRoot, "src", "main.ts");
	const proc = Bun.spawn(["bun", "run", entry, ...args], {
		cwd: options?.cwd || projectRoot,
		env: {
			...process.env,
			...options?.env,
		} as NodeJS.ProcessEnv,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { stdout, stderr, exitCode };
};

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-skill-"));

test("top-level help lists skill without duplicate migrate command", async () => {
	const { stdout, exitCode } = await runCli(["--help"]);
	const text = stripAnsi(stdout);

	expect(exitCode).toBe(0);
	expect(text).toContain("skill");
	expect(text).not.toContain("\n  migrate");
});

test("skill help lists 1.0 subcommands", async () => {
	const { stdout, exitCode } = await runCli(["skill", "--help"]);
	const text = stripAnsi(stdout);

	expect(exitCode).toBe(0);
	expect(text).toContain("list");
	expect(text).toContain("add");
	expect(text).toContain("remove");
	expect(text).toContain("update");
	expect(text).toContain("info");
	expect(text).toContain("run");
	expect(text).toContain("doctor");
	expect(text).toContain("migrate");
});

test("skill list shows bundled and project-added skills", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(
			configPath,
			`api_url: https://example.com
skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
    local-docs:
      source: local
      version: 0.2.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "list"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("tdd");
		expect(text).toContain("diagnose");
		expect(text).toContain("security-review");
		expect(text).toContain("local-docs");
		expect(text).toContain("bundled");
		expect(text).toContain("project");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill add tdd pins bundled skill metadata and preserves existing fields", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
openapi:
  entries:
    - input: ./spec.json
      output: ./src/api
      client: fetch
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "add", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Pinned bundled skill tdd");
		expect(yaml).toContain("api_url: https://example.com");
		expect(yaml).toContain("openapi:");
		expect(yaml).toContain("skills:");
		expect(yaml).toContain("version: 1");
		expect(yaml).toContain("installed:");
		expect(yaml).toContain("tdd:");
		expect(yaml).toContain("source: builtin");
		expect(yaml).toContain("version: 1.0.0");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill add mattpocock/tdd pins bundled Matt Pocock skill without downloading", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(configPath, `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(["skill", "add", "mattpocock/tdd"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Pinned bundled skill tdd");
		expect(yaml).toContain("tdd:");
		expect(yaml).toContain("source: builtin");
		expect(yaml).toContain("version: 1.0.0");
		expect(yaml).not.toContain("github.com/mattpocock/skills");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill add mattpocock/improve-codebase-architecture maps to bundled improve-codebase", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(configPath, `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(
			["skill", "add", "mattpocock/improve-codebase-architecture"],
			{ cwd: root },
		);
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Pinned bundled skill improve-codebase");
		expect(yaml).toContain("improve-codebase:");
		expect(yaml).toContain("source: builtin");
		expect(yaml).not.toContain("github.com/mattpocock/skills");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill remove tdd removes config entry and deletes local skill folder if present", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const skillDir = join(root, ".agents", "skills", "tdd");

	try {
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(join(skillDir, "SKILL.md"), "# TDD\n");
		writeFileSync(
			configPath,
			`skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
    diagnose:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "remove", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("removed");
		expect(yaml).not.toContain("\n    tdd:\n");
		expect(yaml).toContain("diagnose:");
		expect(existsSync(skillDir)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill remove drops empty installed field", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(
			configPath,
			`skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "remove", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("removed");
		expect(yaml).toContain("skills:");
		expect(yaml).toContain("version: 1");
		expect(yaml).not.toContain("installed:");
		expect(yaml).not.toContain("tdd:");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill info tdd prints source version and status", async () => {
	const root = makeTempDir();

	try {
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "info", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("tdd");
		expect(text).toContain("builtin");
		expect(text).toContain("1.0.0");
		expect(text).toContain("project");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill run tdd prints a clear invocation line", async () => {
	const { stdout, exitCode } = await runCli(["skill", "run", "tdd"]);
	const text = stripAnsi(stdout);

	expect(exitCode).toBe(0);
	expect(text).toContain("tdd");
	expect(text).toContain("Run");
});

test("skill doctor reports short bundled skill health", async () => {
	const root = makeTempDir();

	try {
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`api_url: https://example.com
skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "doctor"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("project pins: ready");
		expect(text).toContain("bundled skills: ready");
		expect(text).not.toContain("skills.lock");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill update tdd refreshes bundled skill content locally", async () => {
	const root = makeTempDir();
	const skillPath = join(root, ".agents", "skills", "tdd", "SKILL.md");

	try {
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "update", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("tdd");
		expect(text).toContain("refreshed");
		expect(readFileSync(skillPath, "utf-8")).toContain("name: tdd");
		expect(readFileSync(skillPath, "utf-8")).toContain("Test-Driven Development");
		expect(readFileSync(skillPath, "utf-8")).toContain("Vertical slices via tracer bullets");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill migrate --check is short and does not create config", async () => {
	const root = makeTempDir();

	try {
		const { stdout, exitCode } = await runCli(["skill", "migrate", "--check"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toBe("Bundled skills are ready. Project pins are optional.\n");
		expect(existsSync(join(root, ".fizzyx.yaml"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill migrate --apply preserves existing fields while recording skills.version", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

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
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "migrate", "--apply"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Recorded skills.version: 1");
		expect(yaml).toContain("api_url: https://example.com");
		expect(yaml).toContain("flow:");
		expect(yaml).toContain("skills:");
		expect(yaml).toContain("version: 1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
