import { Effect } from "effect";

const CURRENT_VERSION: string = (() => {
	try {
		return require("../../package.json").version;
	} catch {
		return "0.0.0";
	}
})();

let checked = false;

function isNewer(latest: string): boolean {
	const cur = CURRENT_VERSION.split(".").map(Number);
	const lat = latest.split(".").map(Number);
	for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
		const a = lat[i] ?? 0;
		const b = cur[i] ?? 0;
		if (a > b) return true;
		if (a < b) return false;
	}
	return false;
}

export const checkForUpdate = Effect.gen(function* () {
	if (checked) return;
	checked = true;

	if (process.env.CI || !process.stderr.isTTY) return;

	const latest = yield* Effect.tryPromise({
		try: async () => {
			const res = await fetch("https://registry.npmjs.org/@puffinstudio/fizzyx/latest", {
				signal: AbortSignal.timeout(1000),
			});
			if (!res.ok) return null;
			const data = (await res.json()) as { version: string };
			return data.version;
		},
		catch: () => null as string | null,
	});

	if (!latest || latest === CURRENT_VERSION) return;
	if (!isNewer(latest)) return;

	yield* Effect.tryPromise({
		try: async () => {
			const proc = Bun.spawn(["bun", "add", "-g", "@puffinstudio/fizzyx"], {
				stdout: "ignore",
				stderr: "ignore",
			});
			await proc.exited;
		},
		catch: () => {},
	});
});
