import { Effect } from "effect";
import { ValidationError } from "../domain/errors";

export interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitCommandOptions {
  cwd?: string;
}

export interface GitCommandAdapter {
  run: (
    args: ReadonlyArray<string>,
    options?: GitCommandOptions,
  ) => Effect.Effect<GitCommandResult, ValidationError>;
}

export const gitCommand: GitCommandAdapter = {
  run: (args, options = {}) =>
    Effect.tryPromise({
      try: async () => {
        const proc = Bun.spawn({
          cmd: ["git", ...args],
          cwd: options.cwd ?? process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        return { stdout, stderr, exitCode };
      },
      catch: (cause) => new ValidationError({ message: `Unable to execute git: ${String(cause)}` }),
    }),
};

export interface RequireGitCommandOptions extends GitCommandOptions {
  raw?: boolean;
  errorPrefix?: string;
}

export const requireGitCommand = (
  args: ReadonlyArray<string>,
  options: RequireGitCommandOptions = {},
): Effect.Effect<string, ValidationError> =>
  Effect.gen(function* () {
    const result = yield* gitCommand.run(args, options);
    if (result.exitCode !== 0) {
      // Some git failures explain themselves on stdout, not stderr — `git commit` with
      // nothing staged writes "no changes added to commit" there. Reading stderr alone
      // produced a tautological "git <cmd> failed: git <cmd> failed".
      const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} failed`;
      return yield* new ValidationError({
        message: options.errorPrefix ? `${options.errorPrefix}: ${detail}` : detail,
      });
    }
    return options.raw ? result.stdout : result.stdout.trim();
  });
