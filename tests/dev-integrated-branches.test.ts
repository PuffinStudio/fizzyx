import { expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { commitFile, git, makeRepo, runDev } from "./helpers/git-repo";

const branches = (root: string): string[] =>
  git(root, "branch", "--format", "%(refname:short)").split("\n").sort();

const branchWith = (root: string, name: string, files: ReadonlyArray<string>) => {
  git(root, "checkout", "-b", name);
  for (const file of files) commitFile(root, file, `${file}\n`, `feat: ${file}`);
  git(root, "checkout", "main");
};

/**
 * `fix/picked` and `rework/picked`: every commit cherry-picked onto main. `fix/partial`: one
 * of two. None is an ancestor of main; `rework/` is a prefix FizzyX has no role for.
 */
const makeCherryPickedRepo = () => {
  const repo = makeRepo();
  const { root } = repo;
  branchWith(root, "fix/picked", ["a.txt", "b.txt"]);
  branchWith(root, "rework/picked", ["r.txt"]);
  branchWith(root, "fix/partial", ["c.txt", "d.txt"]);
  // main moves on first, so the picks get new hashes and no branch is an ancestor.
  commitFile(root, "main.txt", "main\n", "chore: unrelated work on main");
  git(root, "cherry-pick", "fix/picked~1", "fix/picked", "rework/picked", "fix/partial~1");
  return repo;
};

const section = (output: string, key: string): string[] => {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => !line.startsWith("  "));
  return rest.slice(0, end === -1 ? rest.length : end).map((line) => line.trim());
};

const names = (entries: ReadonlyArray<string>): string[] =>
  entries.map((entry) => entry.replace(/^- /, "").split(":")[0] ?? "");

test("dev doctor counts cherry-picked branches as integrated whatever their prefix, and names local-only work", async () => {
  const repo = makeCherryPickedRepo();
  try {
    const brief = await runDev(repo.root, "doctor", "--agent");
    expect(brief.exitCode).toBe(0);
    expect(brief.stdout).toContain("merged: 2");
    expect(section(brief.stdout, "merged")).toEqual([]);
    // Work that exists nowhere else is named even without --verbose.
    expect(section(brief.stdout, "local_only")).toEqual([
      "- fix/partial: 1 commit(s) on no remote and not on main",
    ]);

    const verbose = await runDev(repo.root, "doctor", "--agent", "--verbose");
    expect(names(section(verbose.stdout, "merged")).sort()).toEqual([
      "fix/picked",
      "rework/picked",
    ]);
  } finally {
    repo.dispose();
  }
});

test("dev cleanup deletes a cherry-picked work branch only after pinning a ref it can be restored from", async () => {
  const repo = makeCherryPickedRepo();
  const { root } = repo;
  try {
    const tip = git(root, "rev-parse", "fix/picked");

    const preview = await runDev(root, "cleanup", "--agent");
    expect(preview.stdout).toContain("1 merged branch(es)");
    expect(preview.stdout).toContain("fix/picked (cherry-picked, 2 commit(s) on no remote");
    expect(branches(root)).toContain("fix/picked");

    const applied = await runDev(root, "cleanup", "--confirm-delete", "--agent");
    expect(applied.exitCode).toBe(0);
    // The unknown-prefix branch is integrated too, but only work-role branches are deleted;
    // the branch with an unlanded commit stays as well.
    expect(branches(root)).toEqual(["fix/partial", "main", "rework/picked"]);

    expect(git(root, "rev-parse", "refs/fizzyx/deleted/fix/picked")).toBe(tip);
    expect(applied.stdout).toContain("refs/fizzyx/deleted/fix/picked");
    git(root, "branch", "fix/picked", "refs/fizzyx/deleted/fix/picked");
    expect(git(root, "rev-parse", "fix/picked")).toBe(tip);
  } finally {
    repo.dispose();
  }
});

test("a branch whose pick was reverted on the base is reported, not deleted", async () => {
  const repo = makeRepo();
  const { root } = repo;
  try {
    branchWith(root, "fix/reverted", ["x.txt"]);
    commitFile(root, "main.txt", "main\n", "chore: main moves");
    git(root, "cherry-pick", "fix/reverted");
    git(root, "revert", "--no-edit", "HEAD");
    expect(existsSync(join(root, "x.txt"))).toBe(false);

    const doctor = await runDev(root, "doctor", "--agent");
    expect(doctor.stdout).toContain("merged: 0");
    expect(names(section(doctor.stdout, "local_only"))).toEqual(["fix/reverted"]);

    const applied = await runDev(root, "cleanup", "--confirm-delete", "--agent");
    expect(applied.exitCode).toBe(0);
    expect(branches(root)).toEqual(["fix/reverted", "main"]);
  } finally {
    repo.dispose();
  }
});

test("a branch git cannot compare with the base is left alone", async () => {
  const repo = makeCherryPickedRepo();
  const { root } = repo;
  try {
    // Remove a blob the patch comparison has to read, so `git cherry` fails for this branch.
    const blob = git(root, "rev-parse", "fix/picked:b.txt");
    unlinkSync(join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
    git(root, "rm", "-q", "b.txt");
    git(root, "commit", "-q", "-m", "chore: drop b on main");

    const doctor = await runDev(root, "doctor", "--agent");
    expect(names(section(doctor.stdout, "local_only"))).toContain("fix/picked");

    const applied = await runDev(root, "cleanup", "--confirm-delete", "--agent");
    expect(applied.exitCode).toBe(0);
    expect(branches(root)).toContain("fix/picked");
  } finally {
    repo.dispose();
  }
});

test("a base branch name that git could read as an option is refused", async () => {
  const repo = makeRepo(
    'api_url: https://example.com\naccount: 1\nboard: board-1\ndev:\n  production_branch: "--output=pwned"\n',
  );
  const { root } = repo;
  try {
    branchWith(root, "fix/work", ["w.txt"]);
    for (const args of [["cleanup", "--confirm-delete"], ["doctor"], ["status"]]) {
      const result = await runDev(root, ...args, "--agent");
      expect(result.exitCode).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain("not a valid branch name");
    }
    expect(branches(root)).toEqual(["fix/work", "main"]);
    expect(existsSync(join(root, "pwned"))).toBe(false);
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
    branchWith(root, "fix/side", ["s.txt"]);
    git(root, "checkout", "-b", "fix/with-merge");
    commitFile(root, "m.txt", "m\n", "feat: m");
    git(root, "merge", "--no-ff", "fix/side", "-m", "merge side");
    git(root, "checkout", "main");
    commitFile(root, "main.txt", "main\n", "chore: main moves");
    git(root, "cherry-pick", "fix/with-merge~1", "fix/side");

    const { stdout } = await runDev(root, "doctor", "--agent", "--verbose");
    // `fix/side` is plainly cherry-picked; the branch that merged it is left for a person.
    expect(names(section(stdout, "merged"))).toEqual(["fix/side"]);
  } finally {
    repo.dispose();
  }
});
