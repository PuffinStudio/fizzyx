import { Effect } from "effect";
import { ValidationError } from "../domain/errors";

export const readGitCommandOutput = (cwd: string, args: ReadonlyArray<string>) =>
	Effect.tryPromise({
		try: async () => {
			const proc = Bun.spawn({
				cmd: ["git", ...args],
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});

			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);

			if (exitCode !== 0) {
				throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
			}

			return stdout.trim();
		},
		catch: (cause) =>
			new ValidationError({
				message: `Unable to derive done ref from git: ${String(cause)}. Pass an explicit ref.`,
			}),
	});
