import { Effect } from "effect";
import { OssError, FileError, ValidationError, ConfigError } from "../domain/errors";
import type {
	OssConfig,
	OssCredentials,
	OssEnvironmentConfig,
	OssEnvironmentName,
	OssSyncSummary,
	OssStatusResult,
	ProjectConfig,
	SyncEntry,
	SyncManifest,
} from "../domain/models";
import { ConfigRepo } from "../ports/config-repository";
import type { ConfigRepository } from "../ports/config-repository";
import { makeBunManifestRepository, makeEmptyManifest } from "../adapters/bun-manifest-repository";
import { makeBunOssRepository } from "../adapters/bun-oss-repository";
import type { OssRepository } from "../ports/oss-repository";
import type { OssSetupInput } from "../ports/config-repository";
import path from "node:path";

// ─── Bun.secrets constants ───────────────────────────────────

export const OSS_SECRET_SERVICE = "fizzyx-oss";

export const getOssSecretName = (config: ProjectConfig, env: OssEnvironmentName): string => {
	const projectKey = config.board
		? `${config.account}-${config.board}`
		: `root-${Bun.hash(config.rootDir).toString(36).slice(0, 8)}`;
	return Bun.hash(`${projectKey}/${env}`).toString(36);
};

// ─── Public API ──────────────────────────────────────────────

export const ossInitBlank = (): Effect.Effect<void, FileError, ConfigRepository> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));

		if (config?.oss) return;

		const configPath = config?.configPath ?? `${process.cwd()}/.fizzy.yaml`;

		const defaultSync = { localDir: "./public", remotePrefix: "assets" };

		yield* configRepo.setupOssConfig({
			env: "dev",
			config: {
				endpoint: "https://your-s3-endpoint.com",
				region: "your-region",
				bucket: "your-bucket",
			},
			sync: defaultSync,
			configPath,
		});

		yield* configRepo.setupOssConfig({
			env: "prod",
			config: {
				endpoint: "https://your-s3-endpoint.com",
				region: "your-region",
				bucket: "your-bucket",
			},
			sync: defaultSync,
			configPath,
		});
	});

export const ossStoreCredentials = (
	env: OssEnvironmentName,
	accessKeyId: string,
	secretAccessKey: string,
): Effect.Effect<void, OssError, ConfigRepository> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		const projectConfig: ProjectConfig = config || {
			apiUrl: "https://fizzy.puffin.studio",
			account: "1",
			configPath: `${process.cwd()}/.fizzy.yaml`,
			rootDir: process.cwd(),
		};
		yield* storeOssCredentials(projectConfig, env, { accessKeyId, secretAccessKey });
	});

export const ossSetup = (input: OssSetupInput) =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo
			.loadProjectConfigOptional()
			.pipe(Effect.catch(() => Effect.succeed(undefined)));

		const projectConfig: ProjectConfig = config || {
			apiUrl: "https://fizzy.puffin.studio",
			account: "1",
			configPath: `${process.cwd()}/.fizzy.yaml`,
			rootDir: process.cwd(),
		};

		const envConfig = input.config;

		if (envConfig.accessKeyId && envConfig.secretAccessKey) {
			const creds: OssCredentials = {
				accessKeyId: envConfig.accessKeyId,
				secretAccessKey: envConfig.secretAccessKey,
			};
			yield* storeOssCredentials(projectConfig, input.env, creds);
		}

		const ossConfig = yield* configRepo.setupOssConfig(input);
		return ossConfig;
	});

export const ossSync = (options: {
	env: OssEnvironmentName;
	full: boolean;
}): Effect.Effect<
	OssSyncSummary,
	ConfigError | FileError | OssError | ValidationError,
	ConfigRepository
> =>
	Effect.gen(function* () {
		const start = performance.now();
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		const oss = yield* requireOssConfig(config);
		const envConfig = getOssEnvConfig(oss, options.env);
		const resolvedLocalDir = resolvePath(config.rootDir, oss.sync.localDir);
		const remotePrefix = oss.sync.remotePrefix;
		const uploadedKeys: string[] = [];

		const credentials = yield* resolveOssCredentials(config, options.env, envConfig);

		const ossRepo = makeBunOssRepository({
			...envConfig,
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
		});
		const manifestRepo = makeBunManifestRepository(config.rootDir);

		const rawManifest = yield* options.full ? Effect.succeed(null) : manifestRepo.read();

		const manifest = rawManifest ?? makeEmptyManifest(resolvedLocalDir, remotePrefix);

		const localFiles = yield* collectLocalFiles(resolvedLocalDir);
		const errors: string[] = [];

		let uploaded = 0;
		let skipped = 0;

		for (const { absolutePath, relativePath } of localFiles) {
			const result = yield* syncFile(
				ossRepo,
				resolvedLocalDir,
				remotePrefix,
				manifest,
				absolutePath,
				relativePath,
			);
			if (result._tag === "uploaded") {
				uploaded++;
				uploadedKeys.push(result.key);
			} else if (result._tag === "skipped") {
				skipped++;
			} else {
				errors.push(result.error);
			}
		}

		manifest.lastSyncedAt = new Date().toISOString();
		yield* manifestRepo.write(manifest);

		const durationMs = Math.round(performance.now() - start);

		return {
			env: options.env,
			endpoint: envConfig.endpoint,
			bucket: envConfig.bucket,
			remotePrefix,
			uploaded,
			skipped,
			uploadedKeys,
			durationMs,
			errors,
		} satisfies OssSyncSummary;
	});

export const ossStatus = (options: {
	env: OssEnvironmentName;
}): Effect.Effect<OssStatusResult, ConfigError | FileError | ValidationError, ConfigRepository> =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		const oss = yield* requireOssConfig(config);
		const resolvedLocalDir = resolvePath(config.rootDir, oss.sync.localDir);
		const manifestRepo = makeBunManifestRepository(config.rootDir);
		const manifest = yield* manifestRepo.read();

		const localFiles = yield* collectLocalFiles(resolvedLocalDir);
		const localRelPaths = new Set(localFiles.map((f) => f.relativePath));

		let pendingUploads = 0;
		if (manifest) {
			for (const { relativePath } of localFiles) {
				const entry = manifest.files[relativePath];
				if (!entry) {
					pendingUploads++;
					continue;
				}
				const file = localFiles.find((f) => f.relativePath === relativePath);
				const stat = yield* statFile(Bun.file(file!.absolutePath));
				if (stat.mtimeMs !== entry.mtimeMs || stat.size !== entry.size) {
					pendingUploads++;
				}
			}
		} else {
			pendingUploads = localFiles.length;
		}

		let pendingDeletions = 0;
		if (manifest) {
			for (const relPath of Object.keys(manifest.files)) {
				if (!localRelPaths.has(relPath)) {
					pendingDeletions++;
				}
			}
		}

		return {
			env: options.env,
			pendingUploads,
			pendingDeletions,
			totalLocal: localFiles.length,
			manifestEntries: manifest ? Object.keys(manifest.files).length : 0,
			manifestPath: manifestRepo.path(),
		} satisfies OssStatusResult;
	});

// ─── Secrets helpers ─────────────────────────────────────────

const storeOssCredentials = (
	config: ProjectConfig,
	env: OssEnvironmentName,
	credentials: OssCredentials,
): Effect.Effect<void, OssError> =>
	Effect.tryPromise({
		try: () =>
			Bun.secrets.set({
				service: OSS_SECRET_SERVICE,
				name: getOssSecretName(config, env),
				value: JSON.stringify(credentials),
			}),
		catch: (cause) =>
			new OssError({ message: `Failed to store OSS credentials: ${String(cause)}` }),
	});

const resolveOssCredentials = (
	config: ProjectConfig,
	env: OssEnvironmentName,
	envConfig: OssEnvironmentConfig,
): Effect.Effect<OssCredentials, OssError> =>
	Effect.gen(function* () {
		const secretName = getOssSecretName(config, env);

		let fromSecretsRaw: string | null = null;
		try {
			fromSecretsRaw = yield* Effect.promise(() =>
				Bun.secrets.get({ service: OSS_SECRET_SERVICE, name: secretName }),
			);
		} catch {
			// secrets not available — fall through
		}

		if (fromSecretsRaw) {
			try {
				const parsed = JSON.parse(fromSecretsRaw) as Record<string, string>;
				const ak = parsed.accessKeyId;
				const sk = parsed.secretAccessKey;
				if (ak && sk) return { accessKeyId: ak, secretAccessKey: sk } satisfies OssCredentials;
			} catch {
				// invalid JSON in secrets, fall through
			}
		}

		const prefix = `OSS_${env.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
		const envAk = process.env[`${prefix}_ACCESS_KEY_ID`];
		const envSk = process.env[`${prefix}_SECRET_ACCESS_KEY`];
		if (envAk && envSk)
			return { accessKeyId: envAk, secretAccessKey: envSk } satisfies OssCredentials;

		if (envConfig.accessKeyId && envConfig.secretAccessKey) {
			return {
				accessKeyId: envConfig.accessKeyId,
				secretAccessKey: envConfig.secretAccessKey,
			} satisfies OssCredentials;
		}

		return yield* new OssError({
			message: `No OSS credentials for ${env} (service="${OSS_SECRET_SERVICE}" name="${secretName}"). Store with: fizzyx oss setup --env ${env} --access-key-id <key> --secret-access-key <secret>`,
		});
	});

// ─── Internal helpers ────────────────────────────────────────

const requireOssConfig = (config: ProjectConfig): Effect.Effect<OssConfig, ValidationError> =>
	config.oss
		? Effect.succeed(config.oss)
		: Effect.fail(new ValidationError({ message: "No OSS config found. Run: fizzyx oss setup" }));

const getOssEnvConfig = (oss: OssConfig, env: OssEnvironmentName): OssEnvironmentConfig => {
	const config = oss.environments[env];
	if (!config) throw new Error(`OSS environment "${env}" not found in config`);
	return config;
};

const resolvePath = (root: string, sub: string): string =>
	sub.startsWith("/") ? sub : `${root}/${sub}`;

const statFile = (
	file: ReturnType<typeof Bun.file>,
): Effect.Effect<{ mtimeMs: number; size: number }, FileError> =>
	Effect.tryPromise({
		try: () => file.stat(),
		catch: (cause) =>
			new FileError({
				message: `Failed to stat file: ${String(cause)}`,
				path: file.name,
			}),
	});

const hashFile = (absolutePath: string): Effect.Effect<string, FileError> =>
	Effect.tryPromise({
		try: async () => {
			const file = Bun.file(absolutePath);
			const buffer = await file.arrayBuffer();
			const hash = await crypto.subtle.digest("SHA-256", buffer);
			const hex = Array.from(new Uint8Array(hash))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
			return hex;
		},
		catch: (cause) =>
			new FileError({
				message: `Failed to hash file: ${String(cause)}`,
				path: absolutePath,
			}),
	});

const collectLocalFiles = (
	localDir: string,
): Effect.Effect<ReadonlyArray<{ absolutePath: string; relativePath: string }>, FileError> =>
	Effect.tryPromise({
		try: async () => {
			const result: Array<{ absolutePath: string; relativePath: string }> = [];
			const fs = await import("node:fs/promises");

			async function walk(dir: string) {
				let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
				try {
					entries = await fs.readdir(dir, { withFileTypes: true });
				} catch {
					return;
				}
				for (const entry of entries) {
					const fullPath = path.join(dir, entry.name);
					if (entry.isDirectory() && !entry.name.startsWith(".")) {
						await walk(fullPath);
					} else if (entry.isFile()) {
						result.push({
							absolutePath: fullPath,
							relativePath: path.relative(localDir, fullPath),
						});
					}
				}
			}

			await walk(localDir);
			return result;
		},
		catch: (cause) =>
			new FileError({
				message: `Failed to walk directory ${localDir}: ${String(cause)}`,
				path: localDir,
			}),
	});

type SyncFileResult =
	| { _tag: "uploaded"; key: string }
	| { _tag: "skipped" }
	| { _tag: "error"; error: string };

const syncFile = (
	ossRepo: OssRepository,
	localDir: string,
	remotePrefix: string,
	manifest: SyncManifest,
	absolutePath: string,
	relativePath: string,
): Effect.Effect<SyncFileResult, never> =>
	Effect.gen(function* () {
		const existing = manifest.files[relativePath];
		const key = `${remotePrefix}/${relativePath}`;

		const currentStat = yield* statFile(Bun.file(absolutePath));

		if (
			existing &&
			existing.mtimeMs === currentStat.mtimeMs &&
			existing.size === currentStat.size
		) {
			return { _tag: "skipped" } satisfies SyncFileResult;
		}

		if (existing && existing.hash) {
			const currentHash = yield* hashFile(absolutePath);
			if (currentHash === existing.hash) {
				manifest.files[relativePath] = {
					...existing,
					mtimeMs: currentStat.mtimeMs,
					size: currentStat.size,
				};
				return { _tag: "skipped" } satisfies SyncFileResult;
			}
		}

		const currentHash = yield* hashFile(absolutePath);
		const body = Bun.file(absolutePath);
		yield* ossRepo
			.write(key, body)
			.pipe(
				Effect.catch((err) =>
					Effect.fail(new FileError({ message: `Failed to upload ${key}: ${err.message}` })),
				),
			);

		manifest.files[relativePath] = {
			mtimeMs: currentStat.mtimeMs,
			size: currentStat.size,
			hash: currentHash,
		} satisfies SyncEntry;

		return { _tag: "uploaded", key } satisfies SyncFileResult;
	}).pipe(
		Effect.catch((err) =>
			Effect.succeed({
				_tag: "error",
				error: err instanceof Error ? err.message : String(err),
			} as SyncFileResult),
		),
	);
