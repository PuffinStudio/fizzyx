import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-migrate-"));

test("top-level migrate --check reports pending skills migration without writing files", async () => {
	const root = makeTempDir();

	try {
		const { stdout, exitCode } = await runCli(["migrate", "--check"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("skills.version");
		expect(text).toContain("missing");
		expect(existsSync(join(root, ".fizzyx.yaml"))).toBe(false);
		expect(existsSync(join(root, "skills.lock.json"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("top-level migrate --apply creates minimal skills config and no lock file", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");

	try {
		const { stdout, exitCode } = await runCli(["migrate", "--apply"], { cwd: root });
		const text = stripAnsi(stdout);
		const yaml = readFileSync(configPath, "utf-8");

		expect(exitCode).toBe(0);
		expect(text).toContain("applied");
		expect(yaml).toContain("skills:");
		expect(yaml).toContain("version: 1");
		expect(existsSync(join(root, "skills.lock.json"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill migrate --apply preserves existing fields while adding skills.version", async () => {
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
		expect(text).toContain("applied");
		expect(yaml).toContain("api_url: https://example.com");
		expect(yaml).toContain("flow:");
		expect(yaml).toContain("skills:");
		expect(yaml).toContain("version: 1");
		expect(existsSync(join(root, "skills.lock.json"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill migrate --check reports clean config when skills.version already exists", async () => {
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

		const { stdout, exitCode } = await runCli(["skill", "migrate", "--check"], { cwd: root });
		const text = stripAnsi(stdout);

		expect(exitCode).toBe(0);
		expect(text).toContain("up to date");
		expect(text).toContain("no skills.lock.json");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
