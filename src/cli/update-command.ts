import { Effect } from "effect";
import { Command } from "effect/unstable/cli";
import { VERSION } from "../_shared/version";
import { checkFizzyxUpdate, installFizzyxTarget } from "../use-cases/update-service";
import {
	formatAlreadyUpToDate,
	formatInstallRunning,
	formatLocalVersionNewer,
	formatUpdateAvailable,
	formatUpdatedTo,
	formatUpdateCheckMessage,
	formatUpdateInstallFailed,
} from "./update-output";
import { logSuccess, logInfo, logWarn, logError } from "./ui";

const handleUpdate = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		yield* logInfo(formatUpdateCheckMessage());

		const plan = yield* Effect.tryPromise({
			try: () => checkFizzyxUpdate({ currentVersion: VERSION }),
			catch: (cause) =>
				new Error(`Update check failed: ${cause instanceof Error ? cause.message : String(cause)}`),
		});

		if (plan.status === "already-current") {
			yield* logSuccess(formatAlreadyUpToDate(VERSION));
			return;
		}

		if (plan.status === "local-newer") {
			yield* logWarn(formatLocalVersionNewer(plan.currentVersion, plan.latestVersion));
			return;
		}

		yield* logWarn(formatUpdateAvailable(plan.currentVersion, plan.latestVersion));
		yield* logInfo(formatInstallRunning(plan.target));

		const installResult = yield* Effect.tryPromise({
			try: () => installFizzyxTarget(plan.target),
			catch: (cause) =>
				new Error(
					`Failed to run installer: ${cause instanceof Error ? cause.message : String(cause)}`,
				),
		});

		if (installResult.exitCode !== 0) {
			yield* logError(formatUpdateInstallFailed(installResult.exitCode));
			return yield* Effect.fail(new Error("Update installation failed"));
		}

		yield* logSuccess(formatUpdatedTo(plan.latestVersion));
	});

export const updateCmd = Command.make("update", {}, handleUpdate).pipe(
	Command.withDescription("Check and install updates"),
);
