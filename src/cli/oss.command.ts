import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { buildKeyTree } from "./render";
import {
	formatConfiguringKeys,
	formatConfiguringOss,
	formatAccessKeyIdPrompt,
	formatSecretAccessKeyPrompt,
	formatCredentialsStored,
	formatKeysMissingMessage,
	formatManifestPath,
	formatNoCredentialsMessage,
	formatNoObjects,
	formatObjectCount,
	formatOssConfigHint,
	formatBlankLine,
	formatOssConfigWritten,
	formatOssScaffoldWritten,
	formatCheckingOssConfigMessage,
	formatCheckingOssStatusMessage,
	formatListingObjectsMessage,
	formatStoringCredentialsMessage,
	formatWritingOssConfigMessage,
	formatPendingDeletionHeader,
	formatPendingDeletionItem,
	formatPendingUploadHeader,
	formatPendingUploadItem,
	formatSetupUsage,
	formatStatusEnv,
	formatStatusManifestEntries,
	formatStatusPendingDeletions,
	formatStatusPendingUploads,
	formatStatusTotalLocal,
	formatSyncSummary,
	formatUploadedObject,
	formatTruncatedObjects,
} from "./oss-output";
import {
	ossInitBlank,
	ossSetup,
	ossStoreCredentials,
	ossSync,
	ossStatus,
	ossList,
} from "../use-cases/oss-service";
import type { OssSetupInput } from "../ports/config-repository";
import { withSpinner, logSuccess, logError } from "./ui";

const handleLs = (config: { env: string; prefix?: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			formatListingObjectsMessage(config.env),
			ossList({ env: config.env, prefix: config.prefix ?? undefined }),
		);
		if (result.objects.length === 0) {
			yield* Console.log(formatNoObjects(config.env));
			return;
		}
		const tree = buildKeyTree(result.objects as { key: string; size?: number }[]);
		for (const line of tree) {
			yield* Console.log(line);
		}
		if (result.isTruncated) {
			yield* Console.log(formatTruncatedObjects());
		}
		yield* Console.log(formatObjectCount(config.env, result.objects.length));
	});

const handleSyncCmd = (config: {
	env: string;
	full: boolean;
	verify: boolean;
	noUrls: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const stderr = process.stderr;
		const isTTY = stderr.isTTY;
		const frames = ["◐", "◓", "◑", "◒"];
		let frame = 0;
		const actionIcon: Record<string, string> = {
			checking: " ",
			uploading: "\u2191",
			skipping: "\u2192",
			error: "\u2717",
		};
		const progressStartedAt = Date.now();
		let renderedProgress = false;
		const onProgress = (info: { current: number; total: number; file: string; action: string }) => {
			if (!isTTY) return;
			const shouldRender =
				renderedProgress ||
				info.action === "uploading" ||
				info.action === "error" ||
				Date.now() - progressStartedAt > 120;
			if (!shouldRender) return;
			renderedProgress = true;
			const icon = actionIcon[info.action] ?? " ";
			const spinner = frames[frame++ % frames.length];
			const pct = Math.round((info.current / info.total) * 100);
			const barWidth = 16;
			const filled = Math.round((info.current / info.total) * barWidth);
			const bar = "\u2588".repeat(filled) + "\u2591".repeat(Math.max(0, barWidth - filled));
			const label = `  ${spinner} ${config.env} [${bar}] ${pct}%  ${icon} ${info.file}    `;
			stderr.write(`\r${label}`);
		};
		const result = yield* ossSync({
			env: config.env,
			full: config.full,
			verify: config.verify,
			onProgress,
		});
		if (isTTY && renderedProgress) {
			stderr.write("\r\x1b[2K");
		}
		if (result.errors.length > 0) {
			for (const err of result.errors) {
				yield* logError(err);
			}
		}
		const dur =
			result.durationMs >= 1000
				? `${(result.durationMs / 1000).toFixed(1)}s`
				: `${result.durationMs}ms`;
		yield* logSuccess(formatSyncSummary(config.env, result.uploaded, result.skipped, dur));
		if (!config.noUrls && result.uploadedKeys.length > 0) {
			const base = result.endpoint.replace(/\/+$/, "");
			for (const key of result.uploadedKeys) {
				yield* Console.log(formatUploadedObject(base, key));
			}
		}
	});

const handleStatusCmd = (config: { env: string; files: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(
			formatCheckingOssStatusMessage(),
			ossStatus({ env: config.env }),
		);
		yield* Console.log(formatStatusEnv(result.env));
		yield* Console.log(formatStatusTotalLocal(result.totalLocal));
		yield* Console.log(formatStatusManifestEntries(result.manifestEntries));
		yield* Console.log(formatStatusPendingUploads(result.pendingUploads));
		yield* Console.log(formatStatusPendingDeletions(result.pendingDeletions));
		if (config.files) {
			if (result.pendingUploadFiles.length > 0) {
				yield* Console.log(formatPendingUploadHeader());
				for (const file of result.pendingUploadFiles) {
					yield* Console.log(formatPendingUploadItem(file));
				}
			}
			if (result.pendingDeletionFiles.length > 0) {
				yield* Console.log(formatPendingDeletionHeader());
				for (const file of result.pendingDeletionFiles) {
					yield* Console.log(formatPendingDeletionItem(file));
				}
			}
		}
		yield* Console.log(formatManifestPath(result.manifestPath));
	});

const handleSetupCmd = (config: {
	env?: string;
	endpoint?: string;
	region?: string;
	bucket?: string;
	localDir?: string;
	remotePrefix?: string;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const resolvedEnv = config.env ?? "default";

		if (!config.endpoint && !config.region && !config.localDir) {
			const wrote = yield* withSpinner(formatCheckingOssConfigMessage(), ossInitBlank());
			if (wrote) {
				yield* Console.log(formatOssScaffoldWritten());
				yield* Console.log(formatOssConfigHint());
				yield* Console.log(formatBlankLine());
			}
			yield* Console.log(formatConfiguringKeys(resolvedEnv));
			const accessKeyId = yield* promptSecret(formatAccessKeyIdPrompt());
			const secretAccessKey = yield* promptSecret(formatSecretAccessKeyPrompt());
			if (!accessKeyId || !secretAccessKey) {
				yield* Console.log(formatKeysMissingMessage());
				return;
			}
			yield* withSpinner(
				formatStoringCredentialsMessage(),
				ossStoreCredentials(resolvedEnv, accessKeyId, secretAccessKey),
			);
			yield* logSuccess(formatCredentialsStored());
			return;
		}

		if (!config.endpoint || !config.region || !config.localDir) {
			yield* Console.log(formatSetupUsage());
			return;
		}

		yield* Console.log(formatConfiguringOss(resolvedEnv));
		const accessKeyId = yield* promptSecret(formatAccessKeyIdPrompt());
		const secretAccessKey = yield* promptSecret(formatSecretAccessKeyPrompt());
		if (!accessKeyId || !secretAccessKey) {
			yield* Console.log(formatNoCredentialsMessage());
			return;
		}

		const input: OssSetupInput = {
			env: resolvedEnv,
			config: {
				endpoint: config.endpoint,
				region: config.region,
				...(config.bucket ? { bucket: config.bucket } : {}),
				accessKeyId,
				secretAccessKey,
			},
			sync: {
				localDir: config.localDir,
				remotePrefix: config.remotePrefix ?? undefined,
			},
		};
		const result = yield* withSpinner(formatWritingOssConfigMessage(), ossSetup(input));
		const resultEnvConfig = result.environments[resolvedEnv];
		if (!resultEnvConfig) throw new Error(`OSS environment "${resolvedEnv}" not found after setup`);
		yield* logSuccess(formatOssConfigWritten(resolvedEnv, resultEnvConfig.endpoint));
		yield* Console.log(formatCredentialsStored());
	});

const ossLsCmd = Command.make(
	"ls",
	{
		env: Flag.string("env").pipe(
			Flag.withAlias("e"),
			Flag.withDescription("Environment name"),
			Flag.withDefault("dev"),
		),
		prefix: Flag.string("prefix").pipe(Flag.withDescription("Object key prefix filter")),
	},
	handleLs,
).pipe(Command.withDescription("List objects in remote bucket"));

const ossSyncCmd = Command.make(
	"sync",
	{
		env: Flag.string("env").pipe(
			Flag.withAlias("e"),
			Flag.withDescription("Environment name"),
			Flag.withDefault("dev"),
		),
		full: Flag.boolean("full").pipe(Flag.withDescription("Ignore manifest, force full upload")),
		verify: Flag.boolean("verify").pipe(
			Flag.withDescription("Check remote existence before skipping"),
		),
		noUrls: Flag.boolean("no-urls").pipe(Flag.withDescription("Suppress file URL output")),
	},
	handleSyncCmd,
).pipe(Command.withDescription("Sync local files to remote bucket"));

const ossStatusCmd = Command.make(
	"status",
	{
		env: Flag.string("env").pipe(
			Flag.withAlias("e"),
			Flag.withDescription("Environment name"),
			Flag.withDefault("dev"),
		),
		files: Flag.boolean("files").pipe(
			Flag.withDescription("List pending upload and manifest-only files"),
		),
	},
	handleStatusCmd,
).pipe(Command.withDescription("Check OSS sync status"));

const ossSetupCmd = Command.make(
	"setup",
	{
		env: Flag.string("env").pipe(Flag.withAlias("e"), Flag.withDescription("Environment name")),
		endpoint: Flag.string("endpoint").pipe(Flag.withDescription("S3-compatible endpoint URL")),
		region: Flag.string("region").pipe(Flag.withDescription("Region name")),
		bucket: Flag.string("bucket").pipe(Flag.withDescription("Bucket name")),
		localDir: Flag.string("local-dir").pipe(Flag.withDescription("Local directory to sync")),
		remotePrefix: Flag.string("remote-prefix").pipe(Flag.withDescription("Remote key prefix")),
	},
	handleSetupCmd,
).pipe(Command.withDescription("Configure OSS environment"));

const promptSecret = (message: string): Effect.Effect<string, any, any> =>
	Effect.tryPromise({
		try: () =>
			new Promise<string>((resolve) => {
				const rl = require("node:readline").createInterface({
					input: process.stdin,
					output: process.stderr,
				});
				rl.question(message, (value: string) => {
					rl.close();
					resolve(value.trim());
				});
			}),
		catch: (cause) => new Error(String(cause)),
	});

export const ossCmd = Command.make("oss").pipe(
	Command.withDescription("Manage OSS (S3-compatible) storage"),
	Command.withSubcommands([ossLsCmd, ossSyncCmd, ossStatusCmd, ossSetupCmd]),
);
