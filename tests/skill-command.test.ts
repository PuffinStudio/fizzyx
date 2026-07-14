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
	expect(text).toContain("init");
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
		expect(text).toContain("diagnosing-bugs");
		expect(text).toContain("security-review");
		expect(text).toContain("coding-standards");
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
		expect(yaml).toContain("version: 1.4.0");
		expect(readFileSync(join(root, ".agents", "skills", "tdd", "SKILL.md"), "utf8")).toContain(
			"name: tdd",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill init requires an explicit project or global scope", async () => {
	const result = await runCli(["skill", "init"]);

	expect(result.exitCode).not.toBe(0);
	expect(result.stdout + result.stderr).toContain("Choose exactly one");
});

test("skill init --project materializes bundled skills and Codex metadata", async () => {
	const root = makeTempDir();
	try {
		writeFileSync(join(root, ".fizzyx.yaml"), "api_url: https://example.com\n");
		const result = await runCli(["skill", "init", "--project"], { cwd: root });

		expect(result.exitCode).toBe(0);
		expect(readFileSync(join(root, ".agents", "skills", "tdd", "SKILL.md"), "utf8")).toContain(
			"name: tdd",
		);
		expect(
			readFileSync(join(root, ".agents", "skills", "tdd", "agents", "openai.yaml"), "utf8"),
		).toContain('display_name: "TDD"');
		expect(
			readFileSync(join(root, ".agents", "skills", "coding-standards", "SKILL.md"), "utf8"),
		).toContain("name: coding-standards");
		expect(
			readFileSync(
				join(root, ".agents", "skills", "coding-standards", "agents", "openai.yaml"),
				"utf8",
			),
		).toContain("$coding-standards");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill init --global writes outside the repository", async () => {
	const root = makeTempDir();
	const home = join(root, "home");
	const project = join(root, "project");
	try {
		mkdirSync(home, { recursive: true });
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, ".fizzyx.yaml"), "api_url: https://example.com\n");
		const result = await runCli(["skill", "init", "--global"], {
			cwd: project,
			env: { HOME: home },
		});

		expect(result.exitCode).toBe(0);
		expect(readFileSync(join(home, ".agents", "skills", "tdd", "SKILL.md"), "utf8")).toContain(
			"name: tdd",
		);
		expect(existsSync(join(project, ".agents", "skills", "tdd", "SKILL.md"))).toBe(false);
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
		expect(yaml).toContain("version: 1.4.0");
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

test("skill add git-workflow maps to bundled dev-workflow", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(configPath, `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(["skill", "add", "git-workflow"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Pinned bundled skill dev-workflow");
		expect(yaml).toContain("dev-workflow:");
		expect(yaml).toContain("source: builtin");
		expect(yaml).toContain("version: 1.4.0");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill add agent-git maps to bundled dev-workflow", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		writeFileSync(configPath, `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(["skill", "add", "agent-git"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("Pinned bundled skill dev-workflow");
		expect(yaml).toContain("dev-workflow:");
		expect(yaml).toContain("source: builtin");
		expect(yaml).toContain("version: 1.4.0");
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
    diagnosing-bugs:
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
		expect(yaml).toContain("diagnosing-bugs:");
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

test("skill info alias resolves to canonical dev-workflow", async () => {
	const root = makeTempDir();

	try {
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`skills:
  version: 1
  installed:
    dev-workflow:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "info", "git-workflow"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("name: dev-workflow");
		expect(text).toContain("source: builtin");
		expect(text).toContain("version: 1.0.0");
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

test("skill run alias resolves to canonical dev-workflow guidance", async () => {
	const { stdout, exitCode } = await runCli(["skill", "run", "agent-git"]);
	const text = stripAnsi(stdout);

	expect(exitCode).toBe(0);
	expect(text).toContain("dev-workflow");
	expect(text).toContain("Run");
});

test("coding standard aliases resolve to one canonical bundled skill", async () => {
	const root = makeTempDir();
	try {
		writeFileSync(join(root, ".fizzyx.yaml"), "api_url: https://example.com\n");

		const add = await runCli(["skill", "add", "code-quality"], { cwd: root });
		const run = await runCli(["skill", "run", "tool-usage"], { cwd: root });
		const yaml = readFileSync(join(root, ".fizzyx.yaml"), "utf8");

		expect(add.exitCode).toBe(0);
		expect(stripAnsi(add.stdout)).toContain("Pinned bundled skill coding-standards");
		expect(run.exitCode).toBe(0);
		expect(stripAnsi(run.stdout)).toContain("Run `coding-standards`");
		expect(yaml).toContain("coding-standards:");
		expect(yaml).not.toContain("code-quality:");
		expect(
			readFileSync(join(root, ".agents", "skills", "coding-standards", "SKILL.md"), "utf8"),
		).toContain("## 2. Apply the TypeScript and React profile when detected");
		expect(
			readFileSync(join(root, ".agents", "skills", "coding-standards", "SKILL.md"), "utf8"),
		).toContain("## 6. Use tools deliberately");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
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
		expect(text).toContain("project pin versions: stale tdd");
		expect(text).toContain("project skill files: missing tdd");
		expect(text).toContain("fizzyx skill update");
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
		expect(
			readFileSync(join(root, ".agents", "skills", "tdd", "agents", "openai.yaml"), "utf-8"),
		).toContain('display_name: "TDD"');
		expect(readFileSync(skillPath, "utf-8")).toContain("Test-driven development");
		expect(readFileSync(skillPath, "utf-8")).toContain("The TDD Cycle");
		expect(readFileSync(join(root, ".fizzyx.yaml"), "utf8")).toContain("version: 1.4.0");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill update alias refreshes dev-workflow skill content", async () => {
	const root = makeTempDir();
	const skillPath = join(root, ".agents", "skills", "dev-workflow", "SKILL.md");

	try {
		writeFileSync(
			join(root, ".fizzyx.yaml"),
			`skills:
  version: 1
  installed:
    dev-workflow:
      source: builtin
      version: 1.0.0
`,
		);

		const { stdout, exitCode } = await runCli(["skill", "update", "git-workflow"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("refreshed bundled skill dev-workflow");
		expect(readFileSync(skillPath, "utf-8")).toContain("name: dev-workflow");
		expect(readFileSync(skillPath, "utf-8")).toContain("Dev Workflow");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill update --global refreshes only the global copy", async () => {
	const root = makeTempDir();
	const home = join(root, "home");
	const project = join(root, "project");

	try {
		mkdirSync(home, { recursive: true });
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, ".fizzyx.yaml"), "api_url: https://example.com\n");

		const { stdout, exitCode } = await runCli(["skill", "update", "tdd", "--global"], {
			cwd: project,
			env: { HOME: home },
		});

		expect(exitCode).toBe(0);
		expect(stripAnsi(stdout)).toContain("global scope");
		expect(readFileSync(join(home, ".agents", "skills", "tdd", "SKILL.md"), "utf8")).toContain(
			"name: tdd",
		);
		expect(existsSync(join(project, ".agents", "skills", "tdd", "SKILL.md"))).toBe(false);
		expect(readFileSync(join(project, ".fizzyx.yaml"), "utf8")).not.toContain("skills:");
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
