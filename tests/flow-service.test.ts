import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ValidationError } from "../src/domain/errors";
import { resolveDoneRefFromGit } from "../src/use-cases/flow-service";

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fizzyx-cli-"));

test("resolveDoneRefFromGit requires git metadata", async () => {
	const dir = makeTempDir();

	try {
		let error: unknown;

		try {
			await Effect.runPromise(resolveDoneRefFromGit({ cwd: dir }));
			error = undefined;
		} catch (cause) {
			error = cause;
		}

		expect(error).toBeInstanceOf(ValidationError);
		if (error instanceof ValidationError) {
			expect(String(error.message)).toContain("Pass an explicit ref");
		}
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
});
