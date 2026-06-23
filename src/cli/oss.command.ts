import { Console, Effect } from "effect";
import { withSpinner } from "./spinner";
import { buildKeyTree } from "./render";
import { ossInitBlank, ossSetup, ossStoreCredentials, ossSync, ossStatus, ossList } from "../use-cases/oss-service";
import type { OssSetupInput } from "../ports/config-repository";
import { isHelpCommand, hasHelp } from "./_shared/help";
import { parseFlag } from "./_shared/parse";

export const runOss = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(ossUsage());
			return;
		}

		switch (command) {
			case "ls": {
				if (hasHelp(rest)) {
					yield* Console.log(ossLsUsage());
					return;
				}
				const lsEnv = parseOssEnv(rest, "dev");
				const lsPrefix = parseFlag(rest, "--prefix") ?? undefined;
				const result = yield* withSpinner(
					`Listing ${lsEnv}...`,
					ossList({ env: lsEnv, prefix: lsPrefix }),
				);
				if (result.objects.length === 0) {
					yield* Console.log(`${lsEnv}: no objects found`);
					return;
				}
				const tree = buildKeyTree(result.objects as { key: string; size?: number }[]);
				for (const line of tree) {
					yield* Console.log(line);
				}
				if (result.isTruncated) {
					yield* Console.log(`  ... (truncated, more objects available)`);
				}
				yield* Console.log(`${lsEnv}: ${result.objects.length} objects`);
				return;
			}
			case "sync": {
				if (hasHelp(rest)) {
					yield* Console.log(ossSyncUsage());
					return;
				}
				const env = parseOssEnv(rest, "dev");
				const full = rest.includes("--full");
				const verify = rest.includes("--verify");
				const showUrls = !rest.includes("--no-urls");
				const stderr = process.stderr;
				const isTTY = stderr.isTTY;
				const frames = ["◐", "◓", "◑", "◒"];
				let frame = 0;
				const actionIcon: Record<string, string> = {
					checking: " ",
					uploading: "↑",
					skipping: "→",
					error: "✗",
				};
				const progressStartedAt = Date.now();
				let renderedProgress = false;
				const onProgress = (info: {
					current: number;
					total: number;
					file: string;
					action: string;
				}) => {
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
					const bar = "█".repeat(filled) + "░".repeat(Math.max(0, barWidth - filled));
					const label = `  ${spinner} ${env} [${bar}] ${pct}%  ${icon} ${info.file}    `;
					stderr.write(`\r${label}`);
				};
				const result = yield* ossSync({ env, full, verify, onProgress });
				if (isTTY && renderedProgress) {
					stderr.write("\r\x1b[2K");
				}
				if (result.errors.length > 0) {
					for (const err of result.errors) {
						yield* Console.error(`  error: ${err}`);
					}
				}
				const dur =
					result.durationMs >= 1000
						? `${(result.durationMs / 1000).toFixed(1)}s`
						: `${result.durationMs}ms`;
				yield* Console.log(
					`  ✓ ${env} synced · ${result.uploaded} uploaded · ${result.skipped} skipped · ${dur}`,
				);
				if (showUrls && result.uploadedKeys.length > 0) {
					const base = result.endpoint.replace(/\/+$/, "");
					for (const key of result.uploadedKeys) {
						yield* Console.log(`    ${base}/${key}`);
					}
				}
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(ossStatusUsage());
					return;
				}
				const env = parseOssEnv(rest, "dev");
				const showFiles = rest.includes("--files");
				const result = yield* withSpinner("Checking OSS status...", ossStatus({ env }));
				yield* Console.log(`env: ${result.env}`);
				yield* Console.log(`total local files: ${result.totalLocal}`);
				yield* Console.log(`manifest entries: ${result.manifestEntries}`);
				yield* Console.log(`pending uploads: ${result.pendingUploads}`);
				yield* Console.log(`pending deletions: ${result.pendingDeletions}`);
				if (showFiles) {
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
				return;
			}
			case "setup": {
				if (hasHelp(rest)) {
					yield* Console.log(ossSetupUsage());
					return;
				}
				const env = parseOssEnv(rest, "default");
				const endpoint = parseFlag(rest, "--endpoint");
				const region = parseFlag(rest, "--region");
				const bucket = parseFlag(rest, "--bucket");
				const localDir = parseFlag(rest, "--local-dir");
				const remotePrefix = parseFlag(rest, "--remote-prefix");

				if (!endpoint && !region && !bucket && !localDir && remotePrefix === undefined) {
					const wrote = yield* withSpinner("Checking OSS config...", ossInitBlank());
					if (wrote) {
						yield* Console.log("OSS scaffold written to .fizzy.yaml");
						yield* Console.log(
							"Edit endpoint, region, local_dir, and optionally bucket/remote_prefix in the file",
						);
						yield* Console.log("");
					}
					yield* Console.log(`Configuring keys for [${env}]:`);
					const accessKeyId = yield* promptSecret(`  Access Key ID: `);
					const secretAccessKey = yield* promptSecret(`  Secret Access Key: `);
					if (!accessKeyId || !secretAccessKey) {
						yield* Console.log(
							"Keys not provided — add them later with: fizzyx oss setup --env <name>",
						);
						return;
					}
					yield* withSpinner(
						"Storing credentials...",
						ossStoreCredentials(env, accessKeyId, secretAccessKey),
					);
					yield* Console.log(`Credentials stored in OS keychain (service: fizzyx-oss)`);
					return;
				}

				if (!endpoint || !region || !localDir) {
					throw new Error(ossSetupUsage());
				}

				yield* Console.log(`Configuring OSS [${env}]:`);
				const accessKeyId = yield* promptSecret(`  Access Key ID: `);
				const secretAccessKey = yield* promptSecret(`  Secret Access Key: `);
				if (!accessKeyId || !secretAccessKey) {
					throw new Error("Access Key ID and Secret Access Key are required");
				}

				const input: OssSetupInput = {
					env,
					config: { endpoint, region, ...(bucket ? { bucket } : {}), accessKeyId, secretAccessKey },
					sync: { localDir, remotePrefix: remotePrefix ?? undefined },
				};
				const result = yield* withSpinner("Writing OSS config...", ossSetup(input));
				const resultEnvConfig = result.environments[env];
				if (!resultEnvConfig) throw new Error(`OSS environment "${env}" not found after setup`);
				yield* Console.log(`OSS ${env} config written to ${resultEnvConfig.endpoint}`);
				yield* Console.log(`Credentials stored in OS keychain (service: fizzyx-oss)`);
				return;
			}
			default:
				throw new Error(`unknown oss command: ${command}\n\n${ossUsage()}`);
		}
	});

const parseOssEnv = (args: ReadonlyArray<string>, defaultEnv: string): string => {
	if (args.includes("--prod")) return "prod";
	if (args.includes("--env")) {
		const idx = args.indexOf("--env");
		const val = args[idx + 1];
		if (val) return val;
	}
	return defaultEnv;
};

const promptSecret = (message: string): Effect.Effect<string, Error> =>
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

const ossUsage = (): string => `fizzyx oss <command>

commands:
  ls [--env <name>] [--prefix <prefix>]
  sync [--env <name>] [--full] [--no-urls] [--verify]
  status [--env <name>] [--files]
  setup [--env <name> --endpoint <url> --region <region>
         --local-dir <path>] [--bucket <name>] [--remote-prefix <prefix>]`;

const ossLsUsage = (): string =>
	"fizzyx oss ls [--env <name>] [--prefix <prefix>]\n  List objects in the remote bucket";

const ossSyncUsage = (): string =>
	"fizzyx oss sync [--env <name>] [--full] [--no-urls] [--verify]\n  --full: ignore manifest, force full upload\n  --no-urls: suppress file URL output\n  --verify: check remote existence before skipping files";

const ossStatusUsage = (): string =>
	"fizzyx oss status [--env <name>] [--files]\n  --files: list pending upload and manifest-only files";

const ossSetupUsage = (): string =>
	`fizzyx oss setup --env <name> --endpoint <url> --region <region> --local-dir <path> [--bucket <name>] [--remote-prefix <prefix>]\n  With no flags: init blank OSS scaffold in .fizzy.yaml, then prompt for keys\n  --bucket and --remote-prefix are optional; omit if endpoint already contains bucket name\nKeys are prompted interactively (not from args) to avoid shell history.`;
