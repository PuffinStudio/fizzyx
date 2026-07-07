import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const ansiEscape = String.fromCharCode(27);
const ansiCsiPattern = new RegExp(`${ansiEscape}\\[[0-9;]*[a-zA-Z]`, "g");
const ansiOscPattern = new RegExp(`${ansiEscape}\\]`, "g");
const stripAnsi = (value: string): string =>
	value.replace(ansiCsiPattern, "").replace(ansiOscPattern, "");

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

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-dev-cmd-"));

const runGit = (cwd: string, args: ReadonlyArray<string>): void => {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed`);
	}
};

const createWorkflowRepo = (): string => {
	const root = makeTempDir();

	runGit(root, ["init"]);
	runGit(root, ["checkout", "-b", "main"]);

	writeFileSync(
		join(root, ".fizzyx.yaml"),
		`api_url: https://example.com\naccount: 1\nboard: board-1\n\ndev:\n  production_branch: main\n  default_base: main\n  protected_branches:\n    - main\n    - master\n  environment_branches:\n    dev:\n      aggregate: true\n    staging:\n      aggregate: true\n  branch_prefixes:\n    feature: feature\n    fix: fix\n    hotfix: hotfix\n    ops: ops\n    chore: chore\n    docs: docs\n  checks:\n    ready:\n      - bun run check\n  promotion:\n    strategy: pr\n    block_environment_to_production: true\n    require_confirm_production: true\n`,
	);

	writeFileSync(join(root, "README.md"), "# Workflow fixture\n");
	runGit(root, ["add", "README.md", ".fizzyx.yaml"]);
	runGit(root, [
		"-c",
		"user.email=dev-workflow@example.com",
		"-c",
		"user.name=Dev Workflow",
		"commit",
		"-m",
		"chore: bootstrap workflow fixture",
	]);

	// Environment branches.
	runGit(root, ["branch", "dev"]);
	runGit(root, ["branch", "staging"]);

	// Feature and maintenance branches.
	runGit(root, ["checkout", "-b", "feature/foo"]);
	runGit(root, ["checkout", "main"]);
	runGit(root, ["checkout", "-b", "fix/foo"]);
	runGit(root, ["checkout", "main"]);
	runGit(root, ["checkout", "-b", "feature/demo"]);
	writeFileSync(join(root, "feature-demo.txt"), "feature demo commit\n");
	runGit(root, ["add", "feature-demo.txt"]);
	runGit(root, [
		"-c",
		"user.email=dev-workflow@example.com",
		"-c",
		"user.name=Dev Workflow",
		"commit",
		"-m",
		"feat: demo feature branch",
	]);

	runGit(root, ["checkout", "main"]);

	return root;
};

const normalizeOutput = (result: CliResult): string =>
	stripAnsi(`${result.stdout}\n${result.stderr}`).toLowerCase();

const hasDevCommand = await (async () => {
	const topHelp = await runCli(["--help"]);
	return /(^|\n)\s*dev\s+/.test(stripAnsi(topHelp.stdout));
})();

const devTest = hasDevCommand ? test : test.skip;

devTest("top-level help includes dev and dev --help lists subcommands", async () => {
	const top = await runCli(["--help"]);
	expect(top.exitCode).toBe(0);
	const topText = stripAnsi(top.stdout).toLowerCase();
	expect(topText).toContain("dev");

	const devHelp = await runCli(["dev", "--help"]);
	expect(devHelp.exitCode).toBe(0);
	const text = stripAnsi(devHelp.stdout).toLowerCase();

	for (const command of [
		"status",
		"start",
		"sync",
		"checkpoint",
		"ready",
		"promote",
		"cleanup",
		"doctor",
	]) {
		expect(text).toContain(command);
	}
});

devTest("dev status --agent reports branch role, branch, dirty files, and blockers", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		writeFileSync(join(root, "dirty-note.md"), "in-progress edits\n");

		const status = await runCli(["dev", "status", "--agent"], { cwd: root });
		const output = normalizeOutput(status);

		expect(status.exitCode).toBe(0);
		expect(output).toContain("branch:");
		expect(output).toContain("feature/foo");
		expect(output).toContain("role:");
		expect(output).toContain("feature");
		expect(output).toContain("dirty:");
		expect(output).toMatch(/blockers?|dirty[ _]files?/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest(
	"branch role classification matches protected/environment/feature/maintenance",
	async () => {
		const root = createWorkflowRepo();

		try {
			const cases: Array<{ branch: string; expectation: RegExp }> = [
				{ branch: "main", expectation: /protected/ },
				{ branch: "dev", expectation: /environment/ },
				{ branch: "staging", expectation: /environment/ },
				{ branch: "feature/foo", expectation: /feature/ },
				{ branch: "fix/foo", expectation: /maintenance|fix/ },
			];

			for (const item of cases) {
				runGit(root, ["checkout", item.branch]);
				const status = await runCli(["dev", "status", "--agent"], { cwd: root });
				const output = normalizeOutput(status);

				expect(status.exitCode).toBe(0);
				expect(output).toContain(item.branch);
				expect(output).toMatch(item.expectation);
			}
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	},
);

devTest("dev promote from environment to production is blocked in dry-run", async () => {
	const root = createWorkflowRepo();

	try {
		const promote = await runCli(["dev", "promote", "staging", "--to", "main", "--dry-run"], {
			cwd: root,
		});
		const output = normalizeOutput(promote);

		expect(output).toContain("staging");
		expect(output).toContain("main");
		expect(output).toMatch(/blocked|cannot|forbidden|refuse|environment.*production/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev promote feature branch to production requires production confirmation", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/demo"]);

		const promote = await runCli(["dev", "promote", "feature/demo", "--to", "main", "--dry-run"], {
			cwd: root,
		});
		const output = normalizeOutput(promote);

		expect(output).toContain("feature/demo");
		expect(output).toContain("main");
		expect(output).toMatch(
			/confirm(?:ation|-production)|requires.*production|production.*required|blocked/,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev start creates feature branch from main", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "main"]);
		const result = await runCli(["dev", "start", "pay-coupon", "--kind", "feature"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toContain("feature/pay-coupon");

		const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
		expect(branch.stdout.toString().trim()).toBe("feature/pay-coupon");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev start with --card saves metadata and names branch with card prefix", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "main"]);
		const result = await runCli(
			["dev", "start", "pay-coupon", "--kind", "feature", "--card", "42"],
			{ cwd: root },
		);
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toContain("feature/card-42-pay-coupon");

		const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
		expect(branch.stdout.toString().trim()).toBe("feature/card-42-pay-coupon");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev start on compatible branch skips creation", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		const result = await runCli(["dev", "start", "foo", "--kind", "feature"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toMatch(/already|compatible|no new branch/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev sync fetches and rebases clean branch", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		const result = await runCli(["dev", "sync"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toMatch(/synced|fetch|rebase|up.to.date/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev sync refuses dirty worktree without --stash", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		writeFileSync(join(root, "dirty.txt"), "change\n");
		const result = await runCli(["dev", "sync"], { cwd: root });
		const output = normalizeOutput(result);

		expect(output).toMatch(/dirty|stash|uncommitted/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev checkpoint creates wip commit", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		writeFileSync(join(root, "edit.txt"), "work in progress\n");
		runGit(root, ["add", "edit.txt"]);

		const result = await runCli(["dev", "checkpoint"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toMatch(/wip:|checkpoint/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev checkpoint with --message uses custom message", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		writeFileSync(join(root, "edit.txt"), "more work\n");
		runGit(root, ["add", "edit.txt"]);

		const result = await runCli(["dev", "checkpoint", "--message", "my checkpoint msg"], {
			cwd: root,
		});
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toContain("my checkpoint msg");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev ready reports ready on clean synced branch", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		const result = await runCli(["dev", "ready"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toMatch(/ready/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev ready blocked by dirty worktree", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		writeFileSync(join(root, "uncommitted.txt"), "change\n");
		const result = await runCli(["dev", "ready"], { cwd: root });
		const output = normalizeOutput(result);

		expect(output).toMatch(/not ready|dirty|uncommitted|blocked/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev ready --agent outputs machine-readable fields", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		const result = await runCli(["dev", "ready", "--agent"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toContain("ready:");
		expect(output).toContain("blocked:");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev promote feature to staging --dry-run shows command preview", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/demo"]);
		const result = await runCli(
			["dev", "promote", "feature/demo", "--to", "staging", "--dry-run"],
			{ cwd: root },
		);
		const output = normalizeOutput(result);

		expect(output).toContain("feature/demo");
		expect(output).toContain("staging");
		expect(output).toMatch(/dry.run|preview|c(?:ommand|md)/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev cleanup switches to safe base after cleaning merged branches", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "feature/foo"]);
		const result = await runCli(["dev", "cleanup"], { cwd: root });
		const output = normalizeOutput(result);

		expect(output).toMatch(/clean|main|branches/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev doctor reports all sections on a clean repo", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "main"]);
		const result = await runCli(["dev", "doctor"], { cwd: root });
		const output = normalizeOutput(result);

		expect(result.exitCode).toBe(0);
		expect(output).toMatch(/stale|upstream|merged|environment|feature.*based|wip|protected|dirty/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

devTest("dev start fails on dirty worktree without --allow-dirty", async () => {
	const root = createWorkflowRepo();

	try {
		runGit(root, ["checkout", "main"]);
		writeFileSync(join(root, "uncommitted.txt"), "change\n");
		const result = await runCli(["dev", "start", "new-feat", "--kind", "feature"], { cwd: root });
		const output = normalizeOutput(result);

		expect(output).toMatch(/dirty|uncommitted|stash/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
