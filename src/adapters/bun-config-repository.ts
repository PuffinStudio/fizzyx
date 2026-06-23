import { Effect, Layer } from "effect";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigError, FileError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { OFFICIAL_CONFIG_FILE } from "./app-paths";

import type {
	Credentials,
	FlowConfig,
	InitializedProjectConfig,
	OssConfig,
	OssEnvironmentConfig,
	OssSyncConfig,
	ProjectConfig,
} from "../domain/models";
import type { OpenApiGenConfig, OpenApiProjectConfig } from "../domain/openapi-models";
import type {
	ConfigRepository,
	OssSetupInput,
	SetupProjectConfigInput,
} from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import { isTaggedError } from "../_shared/helpers";

export const DEFAULT_ACCOUNT = "1";
const DEFAULT_API_URL = "https://fizzy.puffin.studio";
const DEFAULT_WIP_LIMIT = 5;
const DEFAULT_CACHE_TTL_SECONDS = 900;

export const makeBunConfigRepository = (): ConfigRepository => ({
	loadProjectConfig: () =>
		Effect.gen(function* () {
			const configPath = yield* findConfigPath();
			const text = yield* readText(configPath);
			const rootDir = dirname(configPath);
			return parseProjectConfig(text, configPath, rootDir);
		}),

	loadProjectConfigOptional: () =>
		Effect.gen(function* () {
			const configPath = yield* findConfigPath();
			const text = yield* readText(configPath);
			return parseProjectConfig(text, configPath, dirname(configPath));
		}).pipe(
			Effect.catch((cause) =>
				isTaggedError(cause, "ConfigError") ? Effect.succeed(undefined) : Effect.fail(cause),
			),
		),

	setupProjectConfig: (input) =>
		Effect.gen(function* () {
			const path = input.configPath || `${process.cwd()}/${CONFIG_FILE}`;
			const existingText = yield* readOptionalText(path);
			const config = renderProjectConfig(input, existingText);
			yield* writeText(path, config, 0o600);
			return parseProjectConfig(config, path, dirname(path)) as InitializedProjectConfig;
		}),

	setupOssConfig: (input) =>
		Effect.gen(function* () {
			const path = input.configPath || `${process.cwd()}/${CONFIG_FILE}`;
			const existingText = yield* readOptionalText(path);
			const config = renderOssConfig(input, existingText);
			yield* writeText(path, config, 0o600);
			const parsed = parseOssConfig(parseYaml(config).oss);
			if (!parsed) {
				return yield* new FileError({
					message: "Failed to parse OSS config after writing",
					path,
				});
			}
			return parsed;
		}),

	loadCredentials: (profile) =>
		Effect.gen(function* () {
			const path = yield* credentialPath(profile);
			const fallbackError = new FileError({ message: `No token in ${path}`, path });

			if (existsSync(path)) {
				const local = yield* readCredentials(path).pipe(
					Effect.match({
						onFailure: (error) => error,
						onSuccess: (credentials) => credentials,
					}),
				);

				if (!isTaggedError(local, "FileError")) {
					return local;
				}

				if (!isNoTokenError(local, path)) {
					return yield* Effect.fail(local);
				}
			}

			const officialCredentials = yield* loadOfficialCredentials(profile).pipe(
				Effect.catch(() => Effect.fail(fallbackError)),
			);
			yield* saveCredentials(profile, officialCredentials);
			return officialCredentials;
		}),

	migrateCredentialsFromOfficial: loadOfficialCredentials,

	saveCredentials: (profile, credentials) => saveCredentials(profile, credentials),

	deleteCredentials: (profile) =>
		Effect.gen(function* () {
			const path = yield* credentialPath(profile);
			yield* Effect.tryPromise({
				try: () => Bun.file(path).delete(),
				catch: (cause) =>
					new FileError({ message: `Failed to delete credentials: ${String(cause)}`, path }),
			});
		}),
});

export const Live = Layer.sync(ConfigRepo, () => makeBunConfigRepository());

const saveCredentials = (
	profile: string,
	credentials: Credentials,
): Effect.Effect<void, FileError> =>
	Effect.gen(function* () {
		const path = yield* credentialPath(profile);
		yield* ensureDir(dirname(path));
		yield* writeText(path, `${JSON.stringify(credentials, null, 2)}\n`, 0o600);
	});

const findConfigPath = (): Effect.Effect<string, ConfigError> =>
	Effect.sync(() => {
		let dir = process.cwd();
		while (true) {
			const primary = `${dir}/${CONFIG_FILE}`;
			if (existsSync(primary)) return primary;
			const fallback = `${dir}/${LEGACY_CONFIG_FILE}`;
			if (existsSync(fallback)) return fallback;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		throw new ConfigError({
			message: `No ${CONFIG_FILE} or ${LEGACY_CONFIG_FILE} found from ${process.cwd()}`,
		});
	}).pipe(
		Effect.catch((error) =>
			isTaggedError(error, "ConfigError")
				? Effect.fail(error)
				: Effect.fail(new ConfigError({ message: String(error) })),
		),
	);

const credentialPath = (profile: string): Effect.Effect<string, FileError> =>
	Effect.sync(() => {
		const home = process.env.HOME;
		if (!home) throw new FileError({ message: "HOME is not set" });
		return `${home}/.config/fizzyx/credentials/${safeName(profile)}.json`;
	}).pipe(
		Effect.catch((error) =>
			isTaggedError(error, "FileError")
				? Effect.fail(error)
				: Effect.fail(new FileError({ message: String(error) })),
		),
	);

const officialConfigPath = (): Effect.Effect<string, FileError> =>
	Effect.sync(() => {
		const home = process.env.HOME;
		if (!home) throw new FileError({ message: "HOME is not set" });
		return `${home}/${OFFICIAL_CONFIG_FILE}`;
	}).pipe(
		Effect.catch((error) =>
			isTaggedError(error, "FileError")
				? Effect.fail(error)
				: Effect.fail(new FileError({ message: String(error) })),
		),
	);

const readText = (path: string): Effect.Effect<string, FileError> =>
	Effect.tryPromise({
		try: () => Bun.file(path).text(),
		catch: (cause) => new FileError({ message: `Failed to read ${path}: ${String(cause)}`, path }),
	});

const readOptionalText = (path: string): Effect.Effect<string, FileError> =>
	existsSync(path) ? readText(path) : Effect.succeed("");

const readCredentials = (path: string): Effect.Effect<Credentials, FileError> =>
	readText(path).pipe(
		Effect.map((text) => {
			if (text.trim() === "") {
				throw new FileError({ message: `No token in ${path}`, path });
			}

			const raw = parseFlatJson(text, path);
			const token = typeof raw.token === "string" ? raw.token : "";
			if (token === "") {
				throw new FileError({ message: `No token in ${path}`, path });
			}

			return { token } satisfies Credentials;
		}),
	);

const loadOfficialCredentials = (profile: string): Effect.Effect<Credentials, FileError> =>
	Effect.gen(function* () {
		const path = yield* officialConfigPath();
		const text = yield* readText(path);
		const raw = parseOfficialConfig(text, path);

		const configAccount = coerceStringValue(raw.account);
		if (configAccount !== profile) {
			return yield* new FileError({
				message: `No matching official credential for account ${profile}`,
				path,
			});
		}

		const token = coerceStringValue(raw.token);
		if (token === "") {
			return yield* new FileError({ message: `No token in ${path}`, path });
		}

		return { token } satisfies Credentials;
	});

const writeText = (path: string, text: string, mode: number): Effect.Effect<void, FileError> =>
	Effect.tryPromise({
		try: async () => {
			await Bun.write(path, text);
			await import("node:fs/promises").then((fs) => fs.chmod(path, mode));
		},
		catch: (cause) => new FileError({ message: `Failed to write ${path}: ${String(cause)}`, path }),
	});

const ensureDir = (path: string): Effect.Effect<void, FileError> =>
	Effect.tryPromise({
		try: async () => {
			await import("node:fs/promises").then((fs) =>
				fs.mkdir(path, { recursive: true, mode: 0o700 }),
			);
		},
		catch: (cause) =>
			new FileError({ message: `Failed to create ${path}: ${String(cause)}`, path }),
	});

const parseProjectConfig = (text: string, configPath: string, rootDir: string): ProjectConfig => {
	const raw = parseYaml(text);
	const account = stringValue(raw.account) || DEFAULT_ACCOUNT;
	const apiUrl = stringValue(raw.api_url) || DEFAULT_API_URL;
	const board = stringValue(raw.board) || undefined;
	const flow = parseFlowConfig(raw.flow);
	const oss = parseOssConfig(raw.oss);
	const openapi = parseOpenapiConfig(raw.openapi);
	if (!board) {
		return {
			apiUrl,
			account,
			board: undefined,
			flow,
			oss,
			openapi,
			configPath,
			rootDir,
		};
	}

	return {
		apiUrl,
		account,
		board,
		flow,
		oss,
		openapi,
		configPath,
		rootDir,
	};
};

const parseFlowConfig = (raw: unknown): FlowConfig | undefined => {
	const flow = objectValue(raw);
	const columns = objectValue(flow.columns);
	const todo = stringValue(columns.todo);
	const inProgress = stringValue(columns.in_progress) || stringValue(columns.inProgress);
	if (!todo || !inProgress) return undefined;

	const parsedUsers: Record<string, string> = {};
	for (const [key, value] of Object.entries(objectValue(flow.users))) {
		const userId = stringValue(value);
		if (userId) parsedUsers[key] = userId;
	}

	return {
		columns: {
			todo,
			inProgress,
		},
		users: parsedUsers,
		wipLimit: numberValue(flow.wip_limit) || DEFAULT_WIP_LIMIT,
		cacheTtlSeconds: numberValue(flow.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
	};
};

const renderProjectConfig = (input: SetupProjectConfigInput, existingText = ""): string => {
	const existing = parseYaml(existingText);
	const existingFlow = objectValue(existing.flow);

	const flow = {
		columns: {
			todo: input.todoColumn || stringValue(objectValue(existingFlow.columns).todo) || "",
			in_progress:
				input.inProgressColumn || stringValue(objectValue(existingFlow.columns).in_progress) || "",
		},
		users: parseUsersInput(input.users || {}),
		wip_limit: numberValue(existingFlow.wip_limit) || DEFAULT_WIP_LIMIT,
		cache_ttl: numberValue(existingFlow.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
	} satisfies YamlObject;

	const ordered: YamlObject = {};

	ordered.api_url = input.apiUrl || DEFAULT_API_URL;
	ordered.account = input.account || DEFAULT_ACCOUNT;
	ordered.board = input.board || "";

	for (const key of Object.keys(existing)) {
		if (key !== "api_url" && key !== "account" && key !== "board" && key !== "flow") {
			ordered[key] = existing[key] as YamlValue;
		}
	}

	ordered.flow = flow;

	return Bun.YAML.stringify(ordered, null, 2);
};

// ─── OSS config ──────────────────────────────────────────────

const parseOssConfig = (raw: unknown): OssConfig | undefined => {
	const oss = objectValue(raw);
	if (!oss) return undefined;

	const sync = parseOssSyncConfig(oss.sync);
	if (!sync) return undefined;

	const environments: Record<string, OssEnvironmentConfig> = {};
	for (const key of Object.keys(oss)) {
		if (key === "sync") continue;
		const env = parseOssEnvConfig(oss[key]);
		if (env) environments[key] = env;
	}

	if (Object.keys(environments).length === 0) return undefined;

	return { environments, sync };
};

const parseOssEnvConfig = (raw: unknown): OssEnvironmentConfig | undefined => {
	const obj = objectValue(raw);
	const endpoint = stringValue(obj.endpoint);
	const region = stringValue(obj.region);
	const bucket = stringValue(obj.bucket);
	if (!endpoint || !region) return undefined;
	const config: OssEnvironmentConfig = { endpoint, region };
	if (bucket) config.bucket = bucket;
	const accessKeyId = stringValue(obj.access_key_id);
	const secretAccessKey = stringValue(obj.secret_access_key);
	if (accessKeyId) config.accessKeyId = accessKeyId;
	if (secretAccessKey) config.secretAccessKey = secretAccessKey;
	return config;
};

const parseOpenapiConfig = (raw: unknown): OpenApiProjectConfig | undefined => {
	// Legacy format: flat array of entries
	const arr = arrayValue(raw);
	if (arr) {
		const entries = parseOpenapiEntries(arr);
		return entries ? { entries } : undefined;
	}

	// New format: { posthook: "...", entries: [...] }
	const obj = objectValue(raw);
	if (!obj) return undefined;
	const entriesRaw = obj.entries;
	if (entriesRaw) {
		const entries = parseOpenapiEntries(entriesRaw);
		if (!entries) return undefined;
		return {
			posthook: stringValue(obj.posthook) || undefined,
			entries,
		};
	}

	return undefined;
};

const parseOpenapiEntries = (raw: unknown): OpenApiGenConfig[] | undefined => {
	const arr = arrayValue(raw);
	if (!arr) return undefined;
	const entries: OpenApiGenConfig[] = [];
	for (const item of arr) {
		const obj = objectValue(item);
		const input = stringValue(obj.input);
		const output = stringValue(obj.output);
		const client = stringValue(obj.client);
		if (!input || !output || !client) continue;
		const stateManagement = stringValue(obj.stateManagement) || undefined;
		entries.push({
			input,
			output,
			client,
			apiName: stringValue(obj.apiName) || undefined,
			typesName: stringValue(obj.typesName) || undefined,
			runtimeName: stringValue(obj.runtimeName) || undefined,
			posthook: stringValue(obj.posthook) || undefined,
			shareRuntime: obj.shareRuntime === true || undefined,
			headers: parseObjectHeaders(obj.headers),
			stateManagement,
		});
	}
	return entries.length > 0 ? entries : undefined;
};

const parseOssSyncConfig = (raw: unknown): OssSyncConfig | undefined => {
	const obj = objectValue(raw);
	const localDir = stringValue(obj.local_dir);
	const remotePrefix = stringValue(obj.remote_prefix);
	if (!localDir) return undefined;
	return {
		localDir,
		remotePrefix: remotePrefix ?? "",
		concurrency: numberValue(obj.concurrency) || 10,
	};
};

const renderOssConfig = (input: OssSetupInput, existingText: string): string => {
	const existing = parseYaml(existingText);
	const envKey = input.env;

	const existingOss = objectValue(existing.oss);

	const mergedOss: YamlObject = {
		...existingOss,
		[envKey]: {
			...(existingOss[envKey] as YamlObject | undefined),
			endpoint: input.config.endpoint,
			region: input.config.region,
			...(input.config.bucket ? { bucket: input.config.bucket } : {}),
		},
		sync: {
			...(existingOss.sync as YamlObject | undefined),
			local_dir: input.sync.localDir,
			...(input.sync.remotePrefix ? { remote_prefix: input.sync.remotePrefix } : {}),
			concurrency: input.sync.concurrency ?? 10,
		},
	};

	const ordered: YamlObject = {};
	for (const [key, value] of Object.entries(existing)) {
		if (key === "oss") {
			ordered[key] = mergedOss;
		} else {
			ordered[key] = value;
		}
	}
	if (!("oss" in existing)) {
		ordered.oss = mergedOss;
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

type YamlValue = string | number | boolean | null | YamlObject | readonly YamlValue[];

interface YamlObject {
	[key: string]: YamlValue;
}

const parseYaml = (text: string): YamlObject => {
	if (text.trim() === "") {
		return {};
	}

	const value = Bun.YAML.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ConfigError({ message: "Invalid config format: expected YAML object" });
	}

	return value as YamlObject;
};

const parseFlatJson = (text: string, path: string): Record<string, unknown> => {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch (cause) {
		throw new FileError({ message: `Invalid JSON in ${path}: ${String(cause)}`, path });
	}
};

const parseOfficialConfig = (text: string, path: string): YamlObject => {
	try {
		const raw = Bun.YAML.parse(text);
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error("expected YAML object");
		}

		return raw as YamlObject;
	} catch (cause) {
		throw new FileError({ message: `Invalid official config in ${path}: ${String(cause)}`, path });
	}
};

const parseUsersInput = (users: Record<string, string>): YamlObject => {
	const result: YamlObject = {};
	for (const [name, id] of Object.entries(users)) {
		result[name] = id;
	}
	return result;
};

const stringValue = (value: unknown): string => (typeof value === "string" ? value : "");

const coerceStringValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" ? value.toString() : "";

const isNoTokenError = (error: FileError, path: string): boolean =>
	error.message === `No token in ${path}`;
const numberValue = (value: unknown): number => {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	return Number.parseInt(stringValue(value), 10) || 0;
};
const objectValue = (value: unknown): YamlObject =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as YamlObject) : {};
const arrayValue = (value: unknown): readonly YamlValue[] | undefined =>
	Array.isArray(value) ? (value as readonly YamlValue[]) : undefined;
const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "_");

const parseObjectHeaders = (raw: unknown): Record<string, string> | undefined => {
	const obj = objectValue(raw);
	if (Object.keys(obj).length === 0) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		const val = stringValue(value);
		if (val) result[key] = val;
	}
	return Object.keys(result).length > 0 ? result : undefined;
};
