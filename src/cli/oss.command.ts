import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { buildKeyTree } from "./render";
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
			`Listing ${config.env}...`,
			ossList({ env: config.env, prefix: config.prefix ?? undefined }),
		);
		if (result.objects.length === 0) {
			yield* Console.log(`${config.env}: no objects found`);
			return;
		}
		const tree = buildKeyTree(result.objects as { key: string; size?: number }[]);
		for (const line of tree) {
			yield* Console.log(line);
		}
		if (result.isTruncated) {
			yield* Console.log("  ... (truncated, more objects available)");
		}
		yield* Console.log(`${config.env}: ${result.objects.length} objects`);
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
		yield* logSuccess(
			`${config.env} synced \u00b7 ${result.uploaded} uploaded \u00b7 ${result.skipped} skipped \u00b7 ${dur}`,
		);
		if (!config.noUrls && result.uploadedKeys.length > 0) {
			const base = result.endpoint.replace(/\/+$/, "");
			for (const key of result.uploadedKeys) {
				yield* Console.log(`    ${base}/${key}`);
			}
		}
	});

const handleStatusCmd = (config: { env: string; files: boolean }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner("Checking OSS status...", ossStatus({ env: config.env }));
		yield* Console.log(`env: ${result.env}`);
		yield* Console.log(`total local files: ${result.totalLocal}`);
		yield* Console.log(`manifest entries: ${result.manifestEntries}`);
		yield* Console.log(`pending uploads: ${result.pendingUploads}`);
		yield* Console.log(`pending deletions: ${result.pendingDeletions}`);
		if (config.files) {
			if (result.pendingUploadFiles.length > 0) {
				yield* Console.log("\npending upload files:");
				for (const file of result.pendingUploadFiles) {
					yield* Console.log(`  + ${file}`);
				}
			}
			if (result.pendingDeletionFiles.length > 0) {
				yield* Console.log("\nmanifest-only files:");
				for (const file of result.pendingDeletionFiles) {
					yield* Console.log(`  - ${file}`);
				}
			}
		}
		yield* Console.log(`manifest: ${result.manifestPath}`);
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
			const wrote = yield* withSpinner("Checking OSS config...", ossInitBlank());
			if (wrote) {
				yield* Console.log("OSS scaffold written to .fizzy.yaml");
				yield* Console.log(
					"Edit endpoint, region, local_dir, and optionally bucket/remote_prefix in the file",
				);
				yield* Console.log("");
			}
			yield* Console.log(`Configuring keys for [${resolvedEnv}]:`);
			const accessKeyId = yield* promptSecret("  Access Key ID: ");
			const secretAccessKey = yield* promptSecret("  Secret Access Key: ");
			if (!accessKeyId || !secretAccessKey) {
				yield* Console.log(
					"Keys not provided — add them later with: fizzyx oss setup --env <name>",
				);
				return;
			}
			yield* withSpinner(
				"Storing credentials...",
				ossStoreCredentials(resolvedEnv, accessKeyId, secretAccessKey),
			);
			yield* logSuccess("Credentials stored in OS keychain (service: fizzyx-oss)");
			return;
		}

		if (!config.endpoint || !config.region || !config.localDir) {
			yield* Console.log(
				"Usage: fizzyx oss setup --env <name> --endpoint <url> --region <region> --local-dir <path> [--bucket <name>] [--remote-prefix <prefix>]",
			);
			return;
		}

		yield* Console.log(`Configuring OSS [${resolvedEnv}]:`);
		const accessKeyId = yield* promptSecret("  Access Key ID: ");
		const secretAccessKey = yield* promptSecret("  Secret Access Key: ");
		if (!accessKeyId || !secretAccessKey) {
			yield* Console.log("Access Key ID and Secret Access Key are required");
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
		const result = yield* withSpinner("Writing OSS config...", ossSetup(input));
		const resultEnvConfig = result.environments[resolvedEnv];
		if (!resultEnvConfig) throw new Error(`OSS environment "${resolvedEnv}" not found after setup`);
		yield* logSuccess(`OSS ${resolvedEnv} config written to ${resultEnvConfig.endpoint}`);
		yield* Console.log("Credentials stored in OS keychain (service: fizzyx-oss)");
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
