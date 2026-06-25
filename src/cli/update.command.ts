import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { VERSION } from "../_shared/version";
import {
	formatAlreadyUpToDate,
	formatInstallRunning,
	formatUpdateAvailable,
	formatUpdatedTo,
	formatUpdateCheckMessage,
	formatUpdateInstallFailed,
} from "./update-output";
import { logSuccess, logInfo, logWarn, logError } from "./ui";

const CHECK_URL = "https://registry.npmjs.org/@puffinstudio/fizzyx/latest";
const PACKAGE_NAME = "@puffinstudio/fizzyx";

const handleUpdate = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* logInfo(formatUpdateCheckMessage());

		const latest = yield* Effect.tryPromise({
			try: async (): Promise<string> => {
				const res = await fetch(CHECK_URL, {
					signal: AbortSignal.timeout(5000),
				});
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = (await res.json()) as { version?: string };
				if (!data.version) throw new Error("No version field");
				return data.version;
			},
			catch: (cause) =>
				new Error(
					`Failed to check for updates: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		if (latest === VERSION) {
			yield* logSuccess(formatAlreadyUpToDate(VERSION));
			return;
		}

		yield* logWarn(formatUpdateAvailable(VERSION, latest));
		yield* logInfo(formatInstallRunning());

		const proc = yield* Effect.tryPromise({
			try: async () => {
				const p = Bun.spawnSync(["bun", "add", "-g", PACKAGE_NAME], {
					stdio: ["inherit", "inherit", "inherit"],
				});
				return p;
			},
			catch: (cause) =>
				new Error(
					`Failed to run installer: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		if (proc.exitCode !== 0) {
			yield* logError(formatUpdateInstallFailed());
			return;
		}

		yield* logSuccess(formatUpdatedTo(latest));
	});

export const updateCmd = Command.make("update", {}, handleUpdate).pipe(
	Command.withDescription("Check and install updates"),
);
