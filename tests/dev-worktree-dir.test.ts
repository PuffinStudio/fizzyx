import { expect, test } from "bun:test";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { git, makeRepo, runDev } from "./helpers/git-repo";

const config = (devYaml: string) =>
  `api_url: https://example.com\naccount: 1\nboard: board-1\n${devYaml}`;

const worktreePathOf = (stdout: string): string =>
  stdout.match(/^worktree_path: (.+)$/m)?.[1]?.trim() ?? "";

test("dev.worktree_dir places worktrees beside the main checkout, also when started from another worktree", async () => {
  const repo = makeRepo(config("dev:\n  worktree_dir: ../trees\n"));
  try {
    const trees = join(realpathSync(dirname(repo.root)), "trees");

    const first = await runDev(repo.root, "start", "one", "--kind", "fix", "--worktree", "--agent");
    expect(first.exitCode).toBe(0);
    expect(realpathSync(worktreePathOf(first.stdout))).toBe(join(trees, "fix-one"));
    expect(git(join(trees, "fix-one"), "branch", "--show-current")).toBe("fix/one");

    const second = await runDev(
      join(trees, "fix-one"),
      "start",
      "two",
      "--kind",
      "fix",
      "--worktree",
      "--agent",
    );
    expect(second.exitCode).toBe(0);
    expect(realpathSync(worktreePathOf(second.stdout))).toBe(join(trees, "fix-two"));
  } finally {
    repo.dispose();
  }
});

test("without dev.worktree_dir worktrees stay under the git directory", async () => {
  const repo = makeRepo(config(""));
  try {
    const { stdout } = await runDev(
      repo.root,
      "start",
      "one",
      "--kind",
      "fix",
      "--worktree",
      "--agent",
    );
    expect(realpathSync(worktreePathOf(stdout))).toBe(
      join(realpathSync(repo.root), ".git", "fizzyx", "worktrees", "fix-one"),
    );
  } finally {
    repo.dispose();
  }
});

test("dev start --worktree works from a dirty checkout and leaves its changes alone", async () => {
  const repo = makeRepo(config("dev:\n  worktree_dir: ../trees\n"));
  try {
    writeFileSync(join(repo.root, "README.md"), "# fixture\nuncommitted edit\n");
    writeFileSync(join(repo.root, "untracked.txt"), "scratch\n");

    const inPlace = await runDev(repo.root, "start", "blocked", "--kind", "fix", "--agent");
    expect(inPlace.exitCode).not.toBe(0);

    const worktree = await runDev(
      repo.root,
      "start",
      "ok",
      "--kind",
      "fix",
      "--worktree",
      "--agent",
    );
    expect(worktree.exitCode).toBe(0);

    const path = worktreePathOf(worktree.stdout);
    expect(existsSync(join(path, "untracked.txt"))).toBe(false);
    expect(git(path, "status", "--porcelain")).toBe("");
    expect(git(repo.root, "branch", "--show-current")).toBe("main");
    expect(git(repo.root, "status", "--porcelain").split("\n").sort()).toEqual([
      "?? untracked.txt",
      "M README.md",
    ]);
  } finally {
    repo.dispose();
  }
});
