import { expect, test } from "bun:test";
import { Effect } from "effect";
import { withSpinner } from "../src/cli/spinner";

type WriteOutput = Array<string>;

const makeOutput = (isTTY: boolean) => {
	const output: WriteOutput = [];
	return {
		output,
		err: {
			isTTY,
			write: (value: string) => {
				output.push(value);
			},
		},
	};
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

test("shows animated spinner and clears line on success", async () => {
	const { output, err } = makeOutput(true);

	const result = await Effect.runPromise(
		withSpinner(
			"syncing",
			Effect.promise(() => sleep(25).then(() => "ok")),
			{ stderr: err, env: {}, intervalMs: 5 },
		),
	);

	expect(result).toBe("ok");
	expect(output.some((line) => line.includes("syncing"))).toBe(true);
	expect((output.at(-1) ?? "").includes("\x1b[2K")).toBe(true);
});

test("suppresses spinner output when stderr is not TTY", async () => {
	const { output, err } = makeOutput(false);

	const result = await Effect.runPromise(
		withSpinner(
			"syncing",
			Effect.promise(() => Promise.resolve("ok")),
			{ stderr: err },
		),
	);

	expect(result).toBe("ok");
	expect(output).toHaveLength(0);
});

test("prints a concise status line when non-TTY and requested", async () => {
	const { output, err } = makeOutput(false);

	const result = await Effect.runPromise(
		withSpinner(
			"running",
			Effect.promise(() => Promise.resolve("done")),
			{
				stderr: err,
				showStatusLine: true,
			},
		),
	);

	expect(result).toBe("done");
	expect(output).toStrictEqual(["running\n"]);
});

test.each([
	{ reason: "CI mode", env: { CI: "1" } },
	{ reason: "NO_COLOR mode", env: { NO_COLOR: "1" } },
	{ reason: "disabled by FIZZYX_NO_SPINNER", env: { FIZZYX_NO_SPINNER: "1" } },
])("disables spinner when $reason", async ({ env }) => {
	const { output, err } = makeOutput(true);

	const result = await Effect.runPromise(
		withSpinner(
			"ignored",
			Effect.promise(() => Promise.resolve("done")),
			{
				stderr: err,
				env,
			},
		),
	);

	expect(result).toBe("done");
	expect(output).toHaveLength(0);
});

test("clears spinner line even when effect fails", async () => {
	const { output, err } = makeOutput(true);

	const errored = withSpinner(
		"fails",
		Effect.promise(() => Promise.reject(new Error("spinner failure"))),
		{ stderr: err, env: {}, intervalMs: 5 },
	);

	await expect(Effect.runPromise(errored)).rejects.toThrow("spinner failure");

	expect(output.some((line) => line.includes("\x1b[2K"))).toBe(true);
});
