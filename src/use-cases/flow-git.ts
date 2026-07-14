import { Effect } from "effect";
import { ValidationError } from "../domain/errors";
import { requireGitCommand } from "../adapters/git-command";

export const readGitCommandOutput = (cwd: string, args: ReadonlyArray<string>) =>
	requireGitCommand(args, { cwd }).pipe(
		Effect.mapError(
			(cause) =>
				new ValidationError({
					message: `Unable to derive done ref from git: ${cause.message}. Pass an explicit ref.`,
				}),
		),
	);
