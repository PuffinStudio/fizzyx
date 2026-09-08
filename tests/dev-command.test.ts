import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { resolveUserStateRoot } from "../src/adapters/git-dev-state";
import { resolveDevShellCommand } from "../src/use-cases/dev-service";

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
  // Configure the identity on the repository, not per `git commit` invocation: commits made
  // by the CLI under test (`dev checkpoint`, `ready --squash`) get no `-c` flags from here,
  // so without this they only succeed on a machine that happens to have a global git
  // identity. CI has none, which is where that showed up.
  runGit(root, ["config", "user.email", "dev-workflow@example.com"]);
  runGit(root, ["config", "user.name", "Dev Workflow"]);

  writeFileSync(
    join(root, ".fizzyx.yaml"),
    `api_url: https://example.com\naccount: 1\nboard: board-1\n\ndev:\n  production_branch: main\n  default_base: main\n  protected_branches:\n    - main\n    - master\n  environment_branches:\n    dev:\n      aggregate: true\n    staging:\n      aggregate: true\n  branch_prefixes:\n    feature: feature\n    fix: fix\n    hotfix: hotfix\n    ops: ops\n    chore: chore\n    docs: docs\n  checks:\n    ready:\n      - git diff --check\n  promotion:\n    strategy: pr\n    block_environment_to_production: true\n    require_confirm_production: true\n`,
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
  runGit(root, ["checkout", "-b", "feat/foo"]);
  runGit(root, ["checkout", "main"]);
  runGit(root, ["checkout", "-b", "refactor/foo"]);
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

test("dev shell command uses cmd.exe semantics on Windows", () => {
  const command = resolveDevShellCommand("bun run check", "win32");

  expect(command.slice(1)).toEqual(["/d", "/s", "/c", "bun run check"]);
  expect(command[0]?.toLowerCase()).toContain("cmd");
});

test("local state uses LOCALAPPDATA on Windows", () => {
  expect(
    resolveUserStateRoot("win32", { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" }, "unused"),
  ).toBe("C:\\Users\\dev\\AppData\\Local");
});

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
    expect(output).toContain("dirty_policy:");
    expect(output).toContain("only changes made in this task");
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
        { branch: "feat/foo", expectation: /feature/ },
        { branch: "fix/foo", expectation: /maintenance|fix/ },
        { branch: "refactor/foo", expectation: /maintenance/ },
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

devTest("dev promote apply to production exits non-zero without confirmation", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/demo"]);
    const promote = await runCli(["dev", "promote", "feature/demo", "--to", "main", "--apply"], {
      cwd: root,
    });

    expect(promote.exitCode).not.toBe(0);
    expect(normalizeOutput(promote)).toContain("confirm-production");
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
    const configBefore = readFileSync(join(root, ".fizzyx.yaml"), "utf8");
    const result = await runCli(
      ["dev", "start", "pay-coupon", "--kind", "feature", "--card", "42"],
      { cwd: root },
    );
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toContain("feature/card-42-pay-coupon");

    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
    expect(branch.stdout.toString().trim()).toBe("feature/card-42-pay-coupon");
    expect(readFileSync(join(root, ".fizzyx.yaml"), "utf8")).toBe(configBefore);
    const card = Bun.spawnSync(
      ["git", "config", "--local", "--get", "branch.feature/card-42-pay-coupon.fizzyx-card"],
      { cwd: root },
    );
    expect(card.stdout.toString().trim()).toBe("42");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev status migrates legacy YAML branch metadata into local Git config", async () => {
  const root = createWorkflowRepo();

  try {
    const configPath = join(root, ".fizzyx.yaml");
    const legacyConfig = readFileSync(configPath, "utf8").replace(
      "    require_confirm_production: true\n",
      "    require_confirm_production: true\n  branches:\n    feature/foo:\n      card: 73\n      kind: feature\n      base: main\n      created_at: 2026-07-14T00:00:00.000Z\n",
    );
    writeFileSync(configPath, legacyConfig);
    runGit(root, ["checkout", "feature/foo"]);

    const result = await runCli(["dev", "status", "--agent"], { cwd: root });
    expect(result.exitCode).toBe(0);
    const card = Bun.spawnSync(
      ["git", "config", "--local", "--get", "branch.feature/foo.fizzyx-card"],
      { cwd: root },
    );
    expect(card.stdout.toString().trim()).toBe("73");
    expect(readFileSync(configPath, "utf8")).toBe(legacyConfig);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev status recovers the card number from a standard branch name", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", "feature/card-91-recovered"]);

    const result = await runCli(["dev", "status", "--agent"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("card: 91");
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

devTest("dev start enters an existing matching branch", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    const result = await runCli(["dev", "start", "foo", "--kind", "feature"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("existing branch 'feature/foo'");
    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
    expect(branch.stdout.toString().trim()).toBe("feature/foo");
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

    expect(result.exitCode).not.toBe(0);
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

devTest("dev ready --agent tells agents how to handle their own dirty changes", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    writeFileSync(join(root, "agent-edit.txt"), "agent edit\n");
    const result = await runCli(["dev", "ready", "--agent"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("ready: no");
    expect(output).toContain("next_action:");
    expect(output).toContain("only changes made in this task");
    expect(output).toContain("pre-existing user changes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev baseline accepts unchanged pre-existing files but blocks later edits", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    writeFileSync(join(root, "user-note.txt"), "pre-existing\n");
    const accepted = await runCli(["dev", "baseline", "accept"], { cwd: root });
    expect(accepted.exitCode).toBe(0);

    const unchanged = await runCli(["dev", "status", "--agent"], { cwd: root });
    expect(normalizeOutput(unchanged)).toContain("baseline_files:");
    expect(normalizeOutput(unchanged)).toContain("dirty: no");

    writeFileSync(join(root, "user-note.txt"), "changed during task\n");
    const changed = await runCli(["dev", "ready", "--agent"], { cwd: root });
    expect(changed.exitCode).not.toBe(0);
    expect(normalizeOutput(changed)).toContain("ready: no");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev baseline handles staged renames and paths with spaces", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    writeFileSync(join(root, "old file.txt"), "pre-existing\n");
    runGit(root, ["add", "old file.txt"]);
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-m",
      "test: add rename fixture",
    ]);
    runGit(root, ["mv", "old file.txt", "new file.txt"]);

    const accepted = await runCli(["dev", "baseline", "accept"], { cwd: root });
    expect(accepted.exitCode).toBe(0);
    const status = await runCli(["dev", "status", "--agent"], { cwd: root });
    expect(status.exitCode).toBe(0);
    expect(normalizeOutput(status)).toContain("new file.txt");
    expect(normalizeOutput(status)).toContain("dirty: no");
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

devTest("dev promote checks committed branch changes against ops scope", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", "ops/card-88-deploy"]);
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "runtime.ts"), "export const changed = true;\n");
    runGit(root, ["add", "src/runtime.ts"]);
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-m",
      "ops: change runtime code",
    ]);

    const result = await runCli(
      ["dev", "promote", "ops/card-88-deploy", "--to", "staging", "--dry-run"],
      { cwd: root },
    );
    expect(result.exitCode).not.toBe(0);
    expect(normalizeOutput(result)).toContain("unrelated file");
    expect(normalizeOutput(result)).toContain("src/runtime.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest(
  "production promotion accepts only a full receipt for the current source HEAD",
  async () => {
    const root = createWorkflowRepo();

    try {
      runGit(root, ["checkout", "feature/foo"]);
      const configPath = join(root, ".fizzyx.yaml");
      const config = readFileSync(configPath, "utf8")
        .replace(
          "  checks:\n    ready:\n      - bun run check\n",
          "  checks:\n    ready:\n      - git diff --check\n    full:\n      - git diff --check\n",
        )
        .replace(
          "    require_confirm_production: true\n",
          "    require_confirm_production: true\n    require_ready_for_production: true\n",
        );
      writeFileSync(configPath, config);
      runGit(root, ["add", ".fizzyx.yaml"]);
      runGit(root, [
        "-c",
        "user.email=dev-workflow@example.com",
        "-c",
        "user.name=Dev Workflow",
        "commit",
        "-m",
        "chore: require ready receipt",
      ]);

      const ready = await runCli(["dev", "ready", "--full", "--agent"], { cwd: root });
      expect(ready.exitCode).toBe(0);

      const valid = await runCli(
        ["dev", "promote", "feature/foo", "--to", "main", "--dry-run", "--confirm-production"],
        { cwd: root },
      );
      expect(normalizeOutput(valid)).toContain("valid full readiness receipt");

      writeFileSync(join(root, "after-ready.txt"), "new commit\n");
      runGit(root, ["add", "after-ready.txt"]);
      runGit(root, [
        "-c",
        "user.email=dev-workflow@example.com",
        "-c",
        "user.name=Dev Workflow",
        "commit",
        "-m",
        "chore: invalidate receipt",
      ]);
      const stale = await runCli(
        ["dev", "promote", "feature/foo", "--to", "main", "--dry-run", "--confirm-production"],
        { cwd: root },
      );
      expect(normalizeOutput(stale)).toContain("no valid full readiness receipt");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

devTest("dev promote blocks card-scoped WIP checkpoint commits", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", "feature/card-42-demo"]);
    writeFileSync(join(root, "card-demo.txt"), "card checkpoint\n");
    runGit(root, ["add", "card-demo.txt"]);
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-m",
      "wip(card-42): checkpoint",
    ]);

    const result = await runCli(
      ["dev", "promote", "feature/card-42-demo", "--to", "staging", "--dry-run"],
      { cwd: root },
    );
    const output = normalizeOutput(result);

    expect(output).toMatch(/wip commit|wip commit\(s\)|checkpoint/);
    expect(output).toMatch(/some checks failed|not ready|fix the issues/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup preview does not switch branches", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "cleanup"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/clean|main|branches/);
    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
    expect(branch.stdout.toString().trim()).toBe("feature/foo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup does not delete merged branches without explicit confirmation", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "cleanup"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/preview|confirm|pending|no branches deleted/);
    const branchList = Bun.spawnSync(["git", "branch", "--list", "feature/foo"], {
      cwd: root,
    });
    expect(branchList.stdout.toString()).toContain("feature/foo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup deletes merged branches only with explicit confirmation", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "cleanup", "--confirm-delete"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/deleted|cleaned/);
    const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
    expect(branch.stdout.toString().trim()).toBe("main");
    const branchList = Bun.spawnSync(["git", "branch", "--list", "feature/foo"], {
      cwd: root,
    });
    expect(branchList.stdout.toString()).not.toContain("feature/foo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup refuses abandon deletion without explicit delete confirmation", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/demo"]);
    const result = await runCli(["dev", "cleanup", "--abandon"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/confirm|refus|no branches deleted|pending/);
    const branchList = Bun.spawnSync(["git", "branch", "--list", "feature/demo"], {
      cwd: root,
    });
    expect(branchList.stdout.toString()).toContain("feature/demo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor reports card-scoped WIP checkpoint commits", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    runGit(root, ["checkout", "-b", "feature/card-99-doctor"]);
    writeFileSync(join(root, "doctor-card.txt"), "card checkpoint\n");
    runGit(root, ["add", "doctor-card.txt"]);
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-m",
      "wip(card-99): checkpoint",
    ]);
    runGit(root, ["checkout", "main"]);

    const result = await runCli(["dev", "doctor"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/feature\/card-99-doctor\s+\d+\s+wip commit/);
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

devTest("dev sync recovering from rebase conflict shows recovery instructions", async () => {
  const root = createWorkflowRepo();

  try {
    // Create a conflict: modify README on main, then on feature/foo differently.
    runGit(root, ["checkout", "main"]);
    writeFileSync(join(root, "README.md"), "main change\n");
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-am",
      "main change",
    ]);

    runGit(root, ["checkout", "feature/foo"]);
    writeFileSync(join(root, "README.md"), "feature change\n");
    runGit(root, [
      "-c",
      "user.email=dev-workflow@example.com",
      "-c",
      "user.name=Dev Workflow",
      "commit",
      "-am",
      "feature change",
    ]);

    const result = await runCli(["dev", "sync"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/conflict|recovery|resolve|abort/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev sync with --stash auto-stashes dirty changes before sync", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    writeFileSync(join(root, "dirty.txt"), "in progress\n");

    const result = await runCli(["dev", "sync", "--stash"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/synced|fetch|rebase/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint on clean branch says no changes", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "checkpoint"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toMatch(/no\s*changes|nothing/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev status --agent on detached HEAD reports detached branch", async () => {
  const root = createWorkflowRepo();

  try {
    const hash = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], {
      cwd: root,
    });
    const shortHash = hash.stdout.toString().trim();
    runGit(root, ["checkout", shortHash]);

    const result = await runCli(["dev", "status", "--agent"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toContain("detached/");
    expect(output).toContain(shortHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest(
  "dev start --worktree creates a linked worktree without switching the main tree",
  async () => {
    const root = createWorkflowRepo();

    try {
      runGit(root, ["checkout", "main"]);
      const result = await runCli(
        ["dev", "start", "pay-coupon", "--kind", "feature", "--worktree"],
        {
          cwd: root,
        },
      );
      const output = normalizeOutput(result);

      expect(result.exitCode).toBe(0);
      expect(output).toContain("worktree");
      expect(output).toContain("feature/pay-coupon");

      // Main working tree stays on main.
      const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: root });
      expect(branch.stdout.toString().trim()).toBe("main");

      // The branch exists and is checked out in a linked worktree under .git/fizzyx/worktrees.
      const worktrees = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: root });
      const wtText = worktrees.stdout.toString();
      expect(wtText).toContain("fizzyx/worktrees");
      expect(wtText).toContain("feature/pay-coupon");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

devTest("dev start --worktree fails when the branch is already checked out", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    const first = await runCli(["dev", "start", "pay-coupon", "--kind", "feature", "--worktree"], {
      cwd: root,
    });
    expect(first.exitCode).toBe(0);

    const second = await runCli(["dev", "start", "pay-coupon", "--kind", "feature", "--worktree"], {
      cwd: root,
    });
    const output = normalizeOutput(second);
    expect(second.exitCode).not.toBe(0);
    expect(output).toContain("already checked out");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup preview annotates worktree-backed merged branches", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    await runCli(["dev", "start", "wt-preview", "--kind", "feature", "--worktree"], { cwd: root });

    const result = await runCli(["dev", "cleanup"], { cwd: root });
    const output = normalizeOutput(result);

    expect(output).toContain("feature/wt-preview");
    expect(output).toContain("worktree:");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup --confirm-delete removes a merged worktree and its branch", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    await runCli(["dev", "start", "wt-gone", "--kind", "feature", "--worktree"], { cwd: root });

    const result = await runCli(["dev", "cleanup", "--confirm-delete"], { cwd: root });
    expect(result.exitCode).toBe(0);

    const worktrees = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: root });
    expect(worktrees.stdout.toString()).not.toContain("feature/wt-gone");

    const branchList = Bun.spawnSync(["git", "branch", "--list", "feature/wt-gone"], { cwd: root });
    expect(branchList.stdout.toString()).not.toContain("feature/wt-gone");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor lists linked worktrees and flags merged ones", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    await runCli(["dev", "start", "wt-doc", "--kind", "feature", "--worktree"], { cwd: root });

    const result = await runCli(["dev", "doctor"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toContain("linked worktrees");
    expect(output).toContain("feature/wt-doc");
    expect(output).toMatch(/merged.*cleanup/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev start --agent emits machine-readable worktree path and next_action", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    const result = await runCli(
      ["dev", "start", "agent-wt", "--kind", "feature", "--worktree", "--agent"],
      { cwd: root },
    );
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toContain("branch: feature/agent-wt");
    expect(output).toContain("worktree: yes");
    expect(output).toContain("worktree_path:");
    expect(output).toContain("next_action:");
    expect(output).toMatch(/next_action:.*cd /);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor --agent emits section counts", async () => {
  const root = createWorkflowRepo();
  try {
    runGit(root, ["checkout", "main"]);
    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });
    const output = normalizeOutput(result);
    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/merged:\s*\d/);
    expect(output).toMatch(/worktrees:\s*\d/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint --agent reports no changes machine-readably", async () => {
  const root = createWorkflowRepo();
  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "checkpoint", "--agent"], { cwd: root });
    const output = normalizeOutput(result);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("checkpointed: no");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup --agent reports preview mode", async () => {
  const root = createWorkflowRepo();
  try {
    runGit(root, ["checkout", "feature/foo"]);
    const result = await runCli(["dev", "cleanup", "--agent"], { cwd: root });
    const output = normalizeOutput(result);
    expect(result.exitCode).toBe(0);
    expect(output).toContain("mode: preview");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unconfigured repositories.
//
// Every `fizzyx dev` command must work in a project that has no `.fizzyx.yaml`.
// Without the config the CLI simply does not touch Fizzy cards; the whole git
// half of the workflow still has to work. The fixtures below deliberately write
// no config file so the tests below exercise exactly that path.
// ---------------------------------------------------------------------------

const gitOut = (cwd: string, args: ReadonlyArray<string>): string => {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return proc.stdout.toString().trim();
};

const initRepo = (root: string): void => {
  runGit(root, ["init"]);
  runGit(root, ["checkout", "-b", "main"]);
  runGit(root, ["config", "user.email", "dev-workflow@example.com"]);
  runGit(root, ["config", "user.name", "Dev Workflow"]);
};

const commitAll = (root: string, message: string): void => {
  runGit(root, ["add", "-A"]);
  runGit(root, ["commit", "-m", message]);
};

/** Repository with one commit on `main` and no `.fizzyx.yaml`. */
const createUnconfiguredRepo = (): string => {
  const root = makeTempDir();
  initRepo(root);
  writeFileSync(join(root, "README.md"), "# base\n");
  commitAll(root, "chore: init");
  return root;
};

/** Repository with no commits at all: unborn HEAD, no `.fizzyx.yaml`. */
const createEmptyRepo = (): string => {
  const root = makeTempDir();
  initRepo(root);
  return root;
};

/**
 * `work` clones `remote.git`, and `upstream` is a second clone used to publish
 * commits the way a teammate would. No `.fizzyx.yaml` anywhere.
 */
const createUnconfiguredRepoWithRemote = (): { base: string; work: string; upstream: string } => {
  const base = makeTempDir();
  const remote = join(base, "remote.git");
  mkdirSync(remote);
  runGit(remote, ["init", "--bare"]);
  runGit(remote, ["symbolic-ref", "HEAD", "refs/heads/main"]);

  const upstream = join(base, "upstream");
  mkdirSync(upstream);
  initRepo(upstream);
  writeFileSync(join(upstream, "README.md"), "# base\n");
  commitAll(upstream, "chore: init");
  runGit(upstream, ["remote", "add", "origin", remote]);
  runGit(upstream, ["push", "-u", "origin", "main"]);

  const work = join(base, "work");
  runGit(base, ["clone", remote, work]);
  runGit(work, ["config", "user.email", "dev-workflow@example.com"]);
  runGit(work, ["config", "user.name", "Dev Workflow"]);

  return { base, work, upstream };
};

// --- A1: checkpoint must not commit pre-existing user changes ---------------

devTest("dev checkpoint stages only task-owned files, including untracked ones", async () => {
  const root = createUnconfiguredRepo();

  try {
    // A change the user already had in the tree before the task started.
    writeFileSync(join(root, "README.md"), "# base\nUSER PRE-EXISTING EDIT\n");
    await runCli(["dev", "start", "mytask", "--allow-dirty", "--agent"], { cwd: root });

    // The task's own work: one new untracked file.
    writeFileSync(join(root, "task.txt"), "task work\n");

    const result = await runCli(["dev", "checkpoint", "--agent"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("checkpointed: yes");

    const committed = gitOut(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(committed).toContain("task.txt");
    expect(committed).not.toContain("README.md");

    // The user's pre-existing edit is still theirs, still uncommitted.
    expect(gitOut(root, ["status", "--porcelain"])).toContain("README.md");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint --all commits pre-existing changes and untracked files", async () => {
  const root = createUnconfiguredRepo();

  try {
    writeFileSync(join(root, "README.md"), "# base\nUSER PRE-EXISTING EDIT\n");
    await runCli(["dev", "start", "mytask", "--allow-dirty", "--agent"], { cwd: root });
    writeFileSync(join(root, "task.txt"), "task work\n");

    const result = await runCli(["dev", "checkpoint", "--all", "--agent"], { cwd: root });
    expect(result.exitCode).toBe(0);

    const committed = gitOut(root, ["show", "--name-only", "--format=", "HEAD"]);
    expect(committed).toContain("README.md");
    expect(committed).toContain("task.txt");
    expect(gitOut(root, ["status", "--porcelain"])).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint --all help says it includes pre-existing changes", async () => {
  const help = await runCli(["dev", "checkpoint", "--help"]);
  expect(help.exitCode).toBe(0);
  expect(stripAnsi(help.stdout).toLowerCase()).toContain("pre-existing");
});

// --- A3: checkpoint must refuse protected branches and detached HEAD --------

devTest("dev checkpoint refuses to commit on a protected branch", async () => {
  const root = createUnconfiguredRepo();

  try {
    writeFileSync(join(root, "task.txt"), "task work\n");
    const result = await runCli(["dev", "checkpoint", "--agent"], { cwd: root });

    expect(result.exitCode).not.toBe(0);
    expect(normalizeOutput(result)).toMatch(/protected/);
    expect(gitOut(root, ["log", "--oneline"]).split("\n")).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint --allow-protected overrides the protected branch refusal", async () => {
  const root = createUnconfiguredRepo();

  try {
    writeFileSync(join(root, "task.txt"), "task work\n");
    const result = await runCli(["dev", "checkpoint", "--allow-protected", "--agent"], {
      cwd: root,
    });

    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("checkpointed: yes");
    expect(gitOut(root, ["log", "--oneline"]).split("\n")).toHaveLength(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev checkpoint refuses to commit on a detached HEAD", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    runGit(root, ["checkout", "--detach", "HEAD"]);
    writeFileSync(join(root, "task.txt"), "task work\n");

    const result = await runCli(["dev", "checkpoint", "--agent"], { cwd: root });

    expect(result.exitCode).not.toBe(0);
    expect(normalizeOutput(result)).toMatch(/detached/);
    expect(gitOut(root, ["log", "--oneline"]).split("\n")).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- A2: ready --squash must not rewrite published commits ------------------

devTest("dev ready --squash refuses to collapse commits already pushed to a remote", async () => {
  const { base, work } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(work, "teammate.txt"), "published work\n");
    commitAll(work, "feat: teammate published work");
    runGit(work, ["push", "-u", "origin", "feature/task"]);

    const publishedHead = gitOut(work, ["rev-parse", "HEAD"]);

    writeFileSync(join(work, "wip.txt"), "local wip\n");
    commitAll(work, "wip: checkpoint");

    const result = await runCli(["dev", "ready", "--squash", "--agent"], { cwd: work });

    expect(result.exitCode).not.toBe(0);
    const output = normalizeOutput(result);
    expect(output).toMatch(/already (published|pushed)|remote/);
    expect(output).toContain(publishedHead.slice(0, 7));

    // The published commit is still there, unrewritten.
    expect(gitOut(work, ["rev-parse", "HEAD~1"])).toBe(publishedHead);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev ready --squash still squashes purely local WIP commits", async () => {
  const { base, work } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(work, "a.txt"), "a\n");
    commitAll(work, "wip: one");
    writeFileSync(join(work, "b.txt"), "b\n");
    commitAll(work, "wip: two");

    const result = await runCli(["dev", "ready", "--squash", "--agent"], { cwd: work });

    expect(result.exitCode).toBe(0);
    expect(gitOut(work, ["log", "--oneline", "origin/main..HEAD"]).split("\n")).toHaveLength(1);
    expect(gitOut(work, ["log", "-1", "--format=%s"])).toContain("squash checkpoint commits");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev ready --squash refuses when the WIP commits leave no net change", async () => {
  const { base, work } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    const mergeBase = gitOut(work, ["rev-parse", "HEAD"]);

    // Two commits that cancel out: the branch has history, but no net diff against the base.
    writeFileSync(join(work, "scratch.txt"), "scratch\n");
    commitAll(work, "wip: add scratch");
    rmSync(join(work, "scratch.txt"));
    commitAll(work, "wip: remove scratch again");

    const headBefore = gitOut(work, ["rev-parse", "HEAD"]);
    const result = await runCli(["dev", "ready", "--squash", "--agent"], { cwd: work });

    expect(result.exitCode).not.toBe(0);
    expect(normalizeOutput(result)).toMatch(/no net change/);

    // The branch was not collapsed onto the merge base behind a green verdict.
    expect(gitOut(work, ["rev-parse", "HEAD"])).toBe(headBefore);
    expect(gitOut(work, ["rev-parse", "HEAD"])).not.toBe(mergeBase);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev ready --squash reports a failure rather than passing it as a check", async () => {
  const root = createUnconfiguredRepo();

  try {
    // An orphan branch shares no history with main, so there is no merge base to squash to.
    runGit(root, ["checkout", "--orphan", "feature/orphan"]);
    writeFileSync(join(root, "only.txt"), "only\n");
    commitAll(root, "wip: orphan work");

    const result = await runCli(["dev", "ready", "--squash", "--agent"], { cwd: root });

    expect(result.exitCode).not.toBe(0);
    const output = normalizeOutput(result);
    expect(output).toMatch(/merge base/i);
    // The squash-wip check must not be reported as green when it did not happen.
    expect(output).not.toMatch(/squash-wip[^\n]*\bpassed\b/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- A4: cleanup must not drag an uncommitted tree onto the protected branch -

devTest("dev cleanup --confirm-delete refuses to switch branches with a dirty tree", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(root, "work.txt"), "uncommitted task work\n");

    const result = await runCli(["dev", "cleanup", "--confirm-delete", "--agent"], { cwd: root });

    expect(result.exitCode).not.toBe(0);
    expect(normalizeOutput(result)).toMatch(/uncommitted|dirty/);
    expect(gitOut(root, ["branch", "--show-current"])).toBe("feature/task");
    expect(gitOut(root, ["status", "--porcelain"])).toContain("work.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev cleanup --confirm-delete still works on a clean tree", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    const result = await runCli(["dev", "cleanup", "--confirm-delete", "--agent"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(gitOut(root, ["branch", "--show-current"])).toBe("main");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- B1: sync and status must agree on what "base" means -------------------

devTest("dev sync rebases onto the remote base ref, not the stale local one", async () => {
  const { base, work, upstream } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(work, "task.txt"), "task\n");
    commitAll(work, "feat: task");

    // A teammate advances main on the remote.
    writeFileSync(join(upstream, "upstream.txt"), "upstream work\n");
    commitAll(upstream, "feat: upstream advance");
    runGit(upstream, ["push", "origin", "main"]);
    const advanced = gitOut(upstream, ["rev-parse", "HEAD"]);

    const result = await runCli(["dev", "sync", "--agent"], { cwd: work });
    expect(result.exitCode).toBe(0);

    // The remote base commit is now an ancestor of the feature branch.
    expect(gitOut(work, ["rev-list", "HEAD"]).split("\n")).toContain(advanced);
    expect(gitOut(work, ["rev-list", "--count", "HEAD..origin/main"])).toBe("0");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev status counts behind_base against the remote base with no upstream", async () => {
  const { base, work, upstream } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(work, "task.txt"), "task\n");
    commitAll(work, "feat: task");

    writeFileSync(join(upstream, "upstream.txt"), "upstream work\n");
    commitAll(upstream, "feat: upstream advance");
    runGit(upstream, ["push", "origin", "main"]);
    runGit(work, ["fetch"]);

    const status = await runCli(["dev", "status", "--agent"], { cwd: work });
    const output = normalizeOutput(status);

    expect(status.exitCode).toBe(0);
    expect(output).toContain("has_upstream: no");
    expect(output).toContain("behind_base: 1");
    expect(output).toContain("behind_upstream: 0");
    // `behind` stays an alias of behind_base.
    expect(output).toContain("behind: 1");

    const ready = await runCli(["dev", "ready", "--agent"], { cwd: work });
    expect(ready.exitCode).not.toBe(0);
    expect(normalizeOutput(ready)).toContain("behind base");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev status separates distance from base and distance from upstream", async () => {
  const { base, work, upstream } = createUnconfiguredRepoWithRemote();

  try {
    runGit(work, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(work, "task.txt"), "task\n");
    commitAll(work, "feat: task");
    runGit(work, ["push", "-u", "origin", "feature/task"]);

    // Someone else pushes onto the same feature branch.
    runGit(upstream, ["fetch", "origin"]);
    runGit(upstream, ["checkout", "-b", "feature/task", "origin/feature/task"]);
    writeFileSync(join(upstream, "teammate.txt"), "teammate\n");
    commitAll(upstream, "feat: teammate");
    runGit(upstream, ["push", "origin", "feature/task"]);
    runGit(work, ["fetch"]);

    const status = await runCli(["dev", "status", "--agent"], { cwd: work });
    const output = normalizeOutput(status);

    expect(output).toContain("behind_upstream: 1");
    expect(output).toContain("behind_base: 0");
    // `dev sync` cannot fix a branch that is behind its own upstream, so `ready`
    // must not send the agent into that loop.
    expect(output).not.toMatch(/next_action:.*behind base/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev sync_from_remote: false keeps the old local-base behaviour", async () => {
  const { base, work, upstream } = createUnconfiguredRepoWithRemote();

  try {
    writeFileSync(
      join(work, ".fizzyx.yaml"),
      `api_url: https://example.com\naccount: 1\n\ndev:\n  production_branch: main\n  default_base: main\n  sync_from_remote: false\n`,
    );
    commitAll(work, "chore: add config");
    runGit(work, ["checkout", "-b", "feature/task"]);

    writeFileSync(join(upstream, "upstream.txt"), "upstream work\n");
    commitAll(upstream, "feat: upstream advance");
    runGit(upstream, ["push", "origin", "main"]);
    const advanced = gitOut(upstream, ["rev-parse", "HEAD"]);

    const result = await runCli(["dev", "sync", "--agent"], { cwd: work });
    expect(result.exitCode).toBe(0);
    // Opted out: the remote commit is deliberately not pulled in.
    expect(gitOut(work, ["rev-list", "HEAD"]).split("\n")).not.toContain(advanced);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

devTest("dev sync with the merge strategy also uses the remote base ref", async () => {
  const { base, work, upstream } = createUnconfiguredRepoWithRemote();

  try {
    writeFileSync(
      join(work, ".fizzyx.yaml"),
      `api_url: https://example.com\naccount: 1\n\ndev:\n  production_branch: main\n  default_base: main\n  sync_strategy: merge\n`,
    );
    commitAll(work, "chore: add config");
    runGit(work, ["checkout", "-b", "feature/task"]);

    writeFileSync(join(upstream, "upstream.txt"), "upstream work\n");
    commitAll(upstream, "feat: upstream advance");
    runGit(upstream, ["push", "origin", "main"]);
    const advanced = gitOut(upstream, ["rev-parse", "HEAD"]);

    const result = await runCli(["dev", "sync", "--agent"], { cwd: work });
    expect(result.exitCode).toBe(0);
    expect(gitOut(work, ["rev-list", "HEAD"]).split("\n")).toContain(advanced);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// --- B2: ahead, and the route to `dev ready` --------------------------------

devTest("dev status counts unpushed commits and routes to dev ready", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(root, "a.txt"), "a\n");
    commitAll(root, "feat: one");
    writeFileSync(join(root, "b.txt"), "b\n");
    commitAll(root, "feat: two");

    const status = await runCli(["dev", "status", "--agent"], { cwd: root });
    const output = normalizeOutput(status);

    expect(status.exitCode).toBe(0);
    expect(output).toContain("has_upstream: no");
    expect(output).toContain("ahead: 2");
    expect(output).toMatch(/next_action:.*fizzyx dev ready/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev status on a detached HEAD does not claim the branch is behind base", async () => {
  const root = createUnconfiguredRepo();

  try {
    writeFileSync(join(root, "second.txt"), "second\n");
    commitAll(root, "chore: second");
    runGit(root, ["checkout", "--detach", "HEAD~1"]);

    const status = await runCli(["dev", "status", "--agent"], { cwd: root });
    const output = normalizeOutput(status);

    expect(status.exitCode).toBe(0);
    expect(output).toContain("detached");
    expect(output).not.toMatch(/next_action:.*behind base/);
    expect(output).toMatch(/next_action:.*detached/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- C1: sync must report the real failure ---------------------------------

devTest("dev sync reports the real git error and no conflict script without a rebase", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(root, "task.txt"), "task\n");
    commitAll(root, "feat: task");

    // Baseline-accepted files keep `dirty` false, so sync proceeds and git refuses.
    writeFileSync(join(root, "README.md"), "# base\nPRE-EXISTING\n");
    await runCli(["dev", "baseline", "accept", "--agent"], { cwd: root });

    // Advance main so the rebase has real work to do.
    runGit(root, ["stash", "push", "-m", "hold"]);
    runGit(root, ["checkout", "main"]);
    writeFileSync(join(root, "other.txt"), "other\n");
    commitAll(root, "chore: advance main");
    runGit(root, ["checkout", "feature/task"]);
    runGit(root, ["stash", "pop"]);

    const result = await runCli(["dev", "sync", "--agent"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("unstaged changes");
    expect(output).not.toContain("git rebase --continue");
    expect(output).not.toContain("git rebase --abort");
    expect(output).toContain("--stash");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev sync --stash can sync a baseline-accepted tree", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(root, "task.txt"), "task\n");
    commitAll(root, "feat: task");

    writeFileSync(join(root, "README.md"), "# base\nPRE-EXISTING\n");
    await runCli(["dev", "baseline", "accept", "--agent"], { cwd: root });

    runGit(root, ["stash", "push", "-m", "hold"]);
    runGit(root, ["checkout", "main"]);
    writeFileSync(join(root, "other.txt"), "other\n");
    commitAll(root, "chore: advance main");
    const advanced = gitOut(root, ["rev-parse", "HEAD"]);
    runGit(root, ["checkout", "feature/task"]);
    runGit(root, ["stash", "pop"]);

    const result = await runCli(["dev", "sync", "--stash", "--agent"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(gitOut(root, ["rev-list", "HEAD"]).split("\n")).toContain(advanced);
    // The pre-existing edit is restored, not left in a stash.
    expect(gitOut(root, ["status", "--porcelain"])).toContain("README.md");
    expect(gitOut(root, ["stash", "list"])).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- C2: audit checks that could never fire --------------------------------

devTest("dev doctor reports a dirty protected branch", async () => {
  const root = createUnconfiguredRepo();

  try {
    writeFileSync(join(root, "d1.txt"), "one\n");
    writeFileSync(join(root, "d2.txt"), "two\n");
    writeFileSync(join(root, "README.md"), "# base\ndirty\n");

    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/protected_dirty: [1-9]/);
    expect(output).toContain("main");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor leaves protected_dirty at zero on a clean protected branch", async () => {
  const root = createUnconfiguredRepo();

  try {
    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });
    expect(normalizeOutput(result)).toContain("protected_dirty: 0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor reports feature branches based on an environment branch", async () => {
  const root = createWorkflowRepo();

  try {
    // Give `dev` a commit of its own so it is genuinely ahead of production.
    runGit(root, ["checkout", "dev"]);
    writeFileSync(join(root, "env-only.txt"), "env work\n");
    commitAll(root, "feat: environment-only commit");
    runGit(root, ["checkout", "-b", "feature/on-dev"]);
    writeFileSync(join(root, "on-dev.txt"), "branched from dev\n");
    commitAll(root, "feat: branched off the environment branch");
    runGit(root, ["checkout", "main"]);

    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).toBe(0);
    expect(output).toMatch(/feature_on_env_base: [1-9]/);
    expect(output).toContain("feature/on-dev");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor does not flag feature branches based on production", async () => {
  const root = createWorkflowRepo();

  try {
    runGit(root, ["checkout", "main"]);
    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });
    expect(normalizeOutput(result)).toContain("feature_on_env_base: 0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev promote does not claim file-scope or freshness checks it never ran", async () => {
  const root = createWorkflowRepo();

  try {
    const result = await runCli(
      ["dev", "promote", "feature/demo", "--to", "staging", "--dry-run"],
      { cwd: root },
    );
    const output = normalizeOutput(result);

    // No scope rule exists for `feature` branches, so no verdict is reported either way.
    expect(output).not.toContain("appear related to branch purpose");
    // The freshness check was never computed; the promotion plan starts with `git fetch`.
    expect(output).not.toContain("fetched recently");
    expect(output).not.toContain("may be stale");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- C3: a failed check must say why ----------------------------------------

devTest("dev ready surfaces stderr from a failed check", async () => {
  const root = createUnconfiguredRepo();

  try {
    // The marker must live only in the check's stderr, never in the command text the
    // report echoes back, or the assertion would pass without the fix.
    writeFileSync(join(root, "failing-check.sh"), "echo COMPILER-DIAGNOSTIC 1>&2\nexit 1\n");
    writeFileSync(
      join(root, ".fizzyx.yaml"),
      `api_url: https://example.com\naccount: 1\n\ndev:\n  production_branch: main\n  checks:\n    ready:\n      - bash failing-check.sh\n`,
    );
    commitAll(root, "chore: add config");
    runGit(root, ["checkout", "-b", "feature/task"]);

    const result = await runCli(["dev", "ready"], { cwd: root });
    const output = normalizeOutput(result);

    expect(result.exitCode).not.toBe(0);
    expect(output).toContain("compiler-diagnostic");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev ready runs with no configured checks in an unconfigured repo", async () => {
  const root = createUnconfiguredRepo();

  try {
    runGit(root, ["checkout", "-b", "feature/task"]);
    writeFileSync(join(root, "task.txt"), "task\n");
    commitAll(root, "feat: task");

    const result = await runCli(["dev", "ready", "--agent"], { cwd: root });
    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("ready: yes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- D1: empty repository ---------------------------------------------------

devTest("dev start works in a repository with no commits", async () => {
  const root = createEmptyRepo();

  try {
    const result = await runCli(["dev", "start", "firsttask", "--agent"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("branch: feature/firsttask");
    expect(gitOut(root, ["branch", "--show-current"])).toBe("feature/firsttask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

devTest("dev doctor works in a repository with no commits", async () => {
  const root = createEmptyRepo();

  try {
    const result = await runCli(["dev", "doctor", "--agent"], { cwd: root });

    expect(result.exitCode).toBe(0);
    expect(normalizeOutput(result)).toContain("merged: 0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
