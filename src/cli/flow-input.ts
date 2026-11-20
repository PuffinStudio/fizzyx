import { Effect } from "effect";
import { dirname, resolve } from "node:path";

export const readDescription = (path: string): Effect.Effect<string, any, any> =>
  path === "-"
    ? Effect.tryPromise({
        try: () => Bun.stdin.text(),
        catch: (cause) => new Error(`failed to read stdin: ${String(cause)}`),
      })
    : Effect.tryPromise({
        try: () => Bun.file(path).text(),
        catch: (cause) => new Error(`failed to read ${path}: ${String(cause)}`),
      });

/** Image paths resolve next to the Markdown file, or against cwd for stdin/arguments. */
export const markdownBaseDir = (path: string | undefined): string =>
  path && path !== "-" ? dirname(resolve(path)) : process.cwd();
