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

test("top-level help lists skill and migrate commands", async () => {
	const { stdout, exitCode } = await runCli(["--help"]);
	const text = stripAnsi(stdout);

	expect(exitCode).toBe(0);
	expect(text).toContain("skill");
	expect(text).toContain("migrate");
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

test("skill list shows built-ins and project-installed skills", async () => {
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
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill add tdd writes builtin skill metadata and preserves existing fields", async () => {
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
		expect(text).toContain("tdd");
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
		expect(text).toContain("installed");
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

test("skill doctor reports config health and no skills lock file", async () => {
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
		expect(text).toContain("skills.version");
		expect(text).toContain("1");
		expect(text).toContain("no skills.lock.json");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill update tdd succeeds for builtin skills", async () => {
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

		const { stdout, exitCode } = await runCli(["skill", "update", "tdd"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("tdd");
		expect(text).toContain("up to date");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
