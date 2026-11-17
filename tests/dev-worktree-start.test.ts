import { expect, test } from "bun:test";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, makeRepo, runDev } from "./helpers/git-repo";

test("dev start --worktree works from a dirty checkout, leaves it alone and prints the path on one line", async () => {
  const repo = makeRepo("api_url: https://example.com\naccount: 1\nboard: board-1\n");
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

    const pathLines = worktree.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree_path: "));
    expect(pathLines).toHaveLength(1);
    const path = pathLines[0]!.slice("worktree_path: ".length);
    expect(realpathSync(path)).toBe(
      join(realpathSync(repo.root), ".git", "fizzyx", "worktrees", "fix-ok"),
    );

    expect(existsSync(join(path, "untracked.txt"))).toBe(false);
    expect(git(path, "status", "--porcelain")).toBe("");
    expect(git(path, "branch", "--show-current")).toBe("fix/ok");
    expect(git(repo.root, "branch", "--show-current")).toBe("main");
    expect(git(repo.root, "status", "--porcelain").split("\n").sort()).toEqual([
      "?? untracked.txt",
      "M README.md",
    ]);
  } finally {
    repo.dispose();
  }
});
