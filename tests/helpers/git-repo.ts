import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd: string, ...args: string[]): string => {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${proc.stderr.toString()}`);
  }
  return proc.stdout.toString().trim();
};

export const commitFile = (cwd: string, file: string, content: string, message: string) => {
  writeFileSync(join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", message);
};

/** A repository on `main` with one commit and, optionally, a `.fizzyx.yaml`. */
export const makeRepo = (configYaml?: string): { root: string; dispose: () => void } => {
  const parent = mkdtempSync(join(tmpdir(), "fizzyx-repo-"));
  const root = join(parent, "repo");
  git(parent, "init", "-b", "main", "repo");
  git(root, "config", "user.email", "dev@example.com");
  git(root, "config", "user.name", "Dev");
  if (configYaml !== undefined) writeFileSync(join(root, ".fizzyx.yaml"), configYaml);
  commitFile(root, "README.md", "# fixture\n", "chore: initial commit");
  if (configYaml !== undefined) {
    git(root, "add", ".fizzyx.yaml");
    git(root, "commit", "-m", "chore: add config");
  }
  return { root, dispose: () => rmSync(parent, { recursive: true, force: true }) };
};

export const runDev = async (cwd: string, ...args: string[]) => {
  const entry = join(import.meta.dir, "..", "..", "src", "main.ts");
  const proc = Bun.spawn(["bun", "run", entry, "dev", ...args], {
    cwd,
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
