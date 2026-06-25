import { ConfigError, FileError } from "../domain/errors";
import type {
	Credentials,
	FlowConfig,
	OssConfig,
	OssEnvironmentConfig,
	OssSyncConfig,
	ProjectConfig,
} from "../domain/models";
import type { OpenApiGenConfig, OpenApiProjectConfig } from "../domain/openapi-models";
import type { OssSetupInput, SetupProjectConfigInput } from "../ports/config-repository";

export const DEFAULT_ACCOUNT = "1";
export const DEFAULT_API_URL = "https://fizzy.puffin.studio";
const DEFAULT_WIP_LIMIT = 5;
const DEFAULT_CACHE_TTL_SECONDS = 900;

export const parseProjectConfig = (
	text: string,
	configPath: string,
	rootDir: string,
): ProjectConfig => {
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

export const renderProjectConfig = (input: SetupProjectConfigInput, existingText = ""): string => {
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

export const parseOssConfig = (raw: unknown): OssConfig | undefined => {
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

export const renderOssConfig = (input: OssSetupInput, existingText: string): string => {
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

type OpenApiTemplateInput = {
	entry: OpenApiGenConfig;
	force?: boolean;
};

export const renderOpenApiConfig = (input: OpenApiTemplateInput, existingText: string): string => {
	const existing = parseYaml(existingText);
	const existingOpenapi = existing.openapi;
	const existingEntries = parseOpenapiConfig(existingOpenapi)?.entries ?? [];
	const nextEntries = (input.force ? [] : existingEntries).map(formatOpenApiEntryForYaml);
	nextEntries.push(formatOpenApiEntryForYaml(input.entry));

	const nextOpenapi: YamlObject =
		existingOpenapi && typeof existingOpenapi === "object" && !Array.isArray(existingOpenapi)
			? ({ ...(existingOpenapi as YamlObject), entries: nextEntries } as YamlObject)
			: ({ entries: nextEntries } as YamlObject);

	const ordered: YamlObject = {};
	for (const [key, value] of Object.entries(existing)) {
		if (key === "openapi") {
			ordered[key] = nextOpenapi;
		} else {
			ordered[key] = value;
		}
	}
	if (!("openapi" in existing)) {
		ordered.openapi = nextOpenapi;
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

const formatOpenApiEntryForYaml = (entry: OpenApiGenConfig): YamlObject => {
	const result: YamlObject = {
		input: entry.input,
		output: entry.output,
		client: entry.client,
	};
	if (entry.apiName !== undefined) result.apiName = entry.apiName;
	if (entry.typesName !== undefined) result.typesName = entry.typesName;
	if (entry.runtimeName !== undefined) result.runtimeName = entry.runtimeName;
	if (entry.posthook !== undefined) result.posthook = entry.posthook;
	if (entry.shareRuntime !== undefined) result.shareRuntime = entry.shareRuntime;
	if (entry.headers !== undefined) result.headers = entry.headers as YamlValue;
	if (entry.stateManagement !== undefined) result.stateManagement = entry.stateManagement;
	return result;
};

export const parseCredentialsJson = (text: string, path: string): Credentials => {
	if (text.trim() === "") {
		throw new FileError({ message: `No token in ${path}`, path });
	}

	const raw = parseFlatJson(text, path);
	const token = typeof raw.token === "string" ? raw.token : "";
	if (token === "") {
		throw new FileError({ message: `No token in ${path}`, path });
	}

	return { token };
};

export const parseOfficialConfig = (
	text: string,
	path: string,
): Credentials & { account: string } => {
	try {
		const raw = Bun.YAML.parse(text);
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error("expected YAML object");
		}

		const obj = raw as YamlObject;
		return {
			account: coerceStringValue(obj.account),
			token: coerceStringValue(obj.token),
		};
	} catch (cause) {
		throw new FileError({ message: `Invalid official config in ${path}: ${String(cause)}`, path });
	}
};

export const parseYaml = (text: string): YamlObject => {
	if (text.trim() === "") {
		return {};
	}

	const value = Bun.YAML.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ConfigError({ message: "Invalid config format: expected YAML object" });
	}

	return value as YamlObject;
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
	const arr = arrayValue(raw);
	if (arr) {
		const entries = parseOpenapiEntries(arr);
		return entries ? { entries } : undefined;
	}

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

const numberValue = (value: unknown): number => {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	return Number.parseInt(stringValue(value), 10) || 0;
};

const objectValue = (value: unknown): YamlObject =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as YamlObject) : {};

const arrayValue = (value: unknown): readonly YamlValue[] | undefined =>
	Array.isArray(value) ? (value as readonly YamlValue[]) : undefined;

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

type YamlValue = string | number | boolean | null | YamlObject | readonly YamlValue[];

interface YamlObject {
	[key: string]: YamlValue;
}
