import { expect, test } from "bun:test";
import { makeRepo, runDev } from "./helpers/git-repo";

test("captured output carries no ANSI escape codes", async () => {
  const repo = makeRepo();
  try {
    // `dev cleanup` reports through the coloured status-line helper.
    const { stdout, exitCode } = await runDev(repo.root, "cleanup");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Cleanup preview");
    expect(stdout.includes(String.fromCharCode(27))).toBe(false);
  } finally {
    repo.dispose();
  }
});
