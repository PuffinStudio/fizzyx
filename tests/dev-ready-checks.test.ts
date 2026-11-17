import { expect, test } from "bun:test";
import { commitFile, git, makeRepo, runDev } from "./helpers/git-repo";

const base = "api_url: https://example.com\naccount: 1\nboard: board-1\n";

const readyOnBranch = async (configYaml: string) => {
  const repo = makeRepo(configYaml);
  try {
    git(repo.root, "checkout", "-b", "fix/work");
    commitFile(repo.root, "work.txt", "work\n", "fix: work");
    return await runDev(repo.root, "ready", "--agent");
  } finally {
    repo.dispose();
  }
};

test("dev ready says that nothing was checked when the project configures no checks", async () => {
  const unchecked = await readyOnBranch(base);
  expect(unchecked.exitCode).toBe(0);
  expect(unchecked.stdout).toContain("ready: yes");
  expect(unchecked.stdout).toContain("checks: none configured");

  const checked = await readyOnBranch(`${base}dev:\n  checks:\n    ready:\n      - "true"\n`);
  expect(checked.stdout).toContain("ready: yes");
  expect(checked.stdout).toContain("check: true passed");
  expect(checked.stdout).not.toContain("none configured");
});

test("dev status --agent reports each distance once", async () => {
  const repo = makeRepo(base);
  try {
    const { stdout } = await runDev(repo.root, "status", "--agent");
    const keys = stdout
      .split("\n")
      .filter((line) => /^[a-z_]+:/.test(line))
      .map((line) => line.split(":")[0]);

    expect(keys).toContain("behind_base");
    expect(keys).not.toContain("behind");
    expect(new Set(keys).size).toBe(keys.length);
  } finally {
    repo.dispose();
  }
});
