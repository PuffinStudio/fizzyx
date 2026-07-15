import { Context, type Effect } from "effect";
import type { AdminGenerationError } from "../domain/errors";

export interface AdminProcessOutput {
	stdout: string;
	stderr: string;
}

export interface AdminProcessRunner {
	run: (argv: string[], cwd?: string) => Effect.Effect<AdminProcessOutput, AdminGenerationError>;
}

export const AdminProcessRunner = Context.Service<AdminProcessRunner>("AdminProcessRunner");
