import { expect, test } from "bun:test";
import { commitFile, git, makeRepo, runDev } from "./helpers/git-repo";

/**
 * `picked`: both commits cherry-picked onto main. `partial`: one of two cherry-picked.
 * Neither is an ancestor of main, and both use a prefix FizzyX has no role for.
 */
const makeCherryPickedRepo = () => {
  const repo = makeRepo();
  const { root } = repo;

  git(root, "checkout", "-b", "rework/picked");
  commitFile(root, "a.txt", "a\n", "feat: a");
  commitFile(root, "b.txt", "b\n", "feat: b");
  git(root, "checkout", "main");

  git(root, "checkout", "-b", "rework/partial");
  commitFile(root, "c.txt", "c\n", "feat: c");
  commitFile(root, "d.txt", "d\n", "feat: d");
  git(root, "checkout", "main");

  // main moves on first, so the cherry-picks get new hashes and no branch is an ancestor.
  commitFile(root, "main.txt", "main\n", "chore: unrelated work on main");
  git(root, "cherry-pick", "rework/picked~1", "rework/picked", "rework/partial~1");
  return repo;
};

const section = (output: string, key: string): string[] => {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith("  "));
  return rest.slice(0, end === -1 ? rest.length : end).map((line) => line.trim());
};

test("dev doctor counts a fully cherry-picked branch as integrated and reports the rest as local-only work", async () => {
  const repo = makeCherryPickedRepo();
  try {
    const brief = await runDev(repo.root, "doctor", "--agent");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("merged: 1");
    expect(section(brief.stdout, "merged")).toEqual([]);
    // Work that exists nowhere else is named even without --verbose.
    expect(section(brief.stdout, "local_only")).toEqual([
      "- rework/partial: 1 commit(s) on no remote and not on main",
    ]);

    const verbose = await runDev(repo.root, "doctor", "--agent", "--verbose");
    expect(section(verbose.stdout, "merged")).toEqual([
      "- rework/picked: Every commit is on main (cherry-picked)",
    ]);
  } finally {
    repo.dispose();
  }
});

test("dev cleanup --confirm-delete removes the cherry-picked branch and keeps the one with unlanded work", async () => {
  const repo = makeCherryPickedRepo();
  try {
    const preview = await runDev(repo.root, "cleanup", "--agent");
    expect(preview.stdout).toContain("1 merged branch(es)");
    expect(preview.stdout).toContain("rework/picked");
    expect(preview.stdout).not.toContain("rework/partial");

    const applied = await runDev(repo.root, "cleanup", "--confirm-delete", "--agent");
    expect(applied.exitCode).toBe(0);
    expect(git(repo.root, "branch", "--format", "%(refname:short)").split("\n").sort()).toEqual([
      "main",
      "rework/partial",
    ]);
  } finally {
    repo.dispose();
  }
});

test("a branch whose commits are on a remote is not reported as local-only", async () => {
  const repo = makeRepo();
  try {
    git(repo.root, "init", "--bare", "../remote.git");
    git(repo.root, "remote", "add", "origin", "../remote.git");
    git(repo.root, "checkout", "-b", "fix/pushed");
    commitFile(repo.root, "p.txt", "p\n", "fix: pushed work");
    git(repo.root, "push", "-u", "origin", "fix/pushed");
    git(repo.root, "checkout", "main");

    const { stdout } = await runDev(repo.root, "doctor", "--agent");
    expect(stdout).toContain("local_only: 0");
    expect(stdout).toContain("merged: 0");
  } finally {
    repo.dispose();
  }
});

test("a branch containing a merge commit is never called integrated by patch equivalence", async () => {
  const repo = makeRepo();
  const { root } = repo;
  try {
    git(root, "checkout", "-b", "side");
    commitFile(root, "s.txt", "s\n", "feat: side");
    git(root, "checkout", "main");
    git(root, "checkout", "-b", "feat/with-merge");
    commitFile(root, "m.txt", "m\n", "feat: m");
    git(root, "merge", "--no-ff", "side", "-m", "merge side");
    git(root, "checkout", "main");
    commitFile(root, "main.txt", "main\n", "chore: main moves");
    git(root, "cherry-pick", "feat/with-merge~1", "side");

    const { stdout } = await runDev(root, "doctor", "--agent", "--verbose");
    // `side` is plainly cherry-picked; the branch that merged it is left for a person to judge.
    expect(section(stdout, "merged")).toEqual(["- side: Every commit is on main (cherry-picked)"]);
  } finally {
    repo.dispose();
  }
});
