import { Effect, Layer } from "effect";
import { AdminGenerationError } from "../domain/errors";
import { AdminProcessRunner } from "../ports/admin-process-runner";

export const makeBunAdminProcessRunner = (): AdminProcessRunner => ({
	run: (argv, cwd) =>
		Effect.tryPromise({
			try: async () => {
				const process = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(process.stdout).text(),
					new Response(process.stderr).text(),
					process.exited,
				]);
				if (exitCode !== 0) {
					throw new AdminGenerationError({
						message: `${argv[0]} exited with code ${exitCode}`,
						command: argv,
						stderr,
					});
				}
				return { stdout, stderr };
			},
			catch: (cause) =>
				cause instanceof AdminGenerationError
					? cause
					: new AdminGenerationError({
							message: `failed to run ${argv[0]}`,
							command: argv,
							cause,
						}),
		}),
});

export const AdminProcessRunnerLive = Layer.succeed(
	AdminProcessRunner,
	makeBunAdminProcessRunner(),
);
