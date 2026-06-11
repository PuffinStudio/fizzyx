import { Effect } from "effect";
import { existsSync } from "node:fs";
import { ConfigError, FileError } from "../domain/errors";
import { DEFAULT_FLOW_CARD_LANGUAGE, type FlowCardLanguage } from "../domain/models";
import type {
	Credentials,
	FlowConfig,
	InitializedProjectConfig,
	ProjectConfig,
} from "../domain/models";
import type { ConfigRepository, SetupProjectConfigInput } from "../ports/config-repository";

const CONFIG_FILE = ".fizzy.yaml";
const OFFICIAL_CONFIG_FILE = ".config/fizzy/config.yaml";
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
			const path = `${dir}/${CONFIG_FILE}`;
			if (existsSync(path)) return path;
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		throw new ConfigError({ message: `No ${CONFIG_FILE} found from ${process.cwd()}` });
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

const isTaggedError = (error: unknown, tag: string): error is { _tag: string } =>
	typeof error === "object" &&
	error !== null &&
	"_tag" in error &&
	(error as { _tag: unknown })._tag === tag;

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
	if (!board) {
		return {
			apiUrl,
			account,
			board: undefined,
			flow,
			configPath,
			rootDir,
		};
	}

	return {
		apiUrl,
		account,
		board,
		flow,
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
		card: {
			language: parseCardLanguage(flow.card) || DEFAULT_FLOW_CARD_LANGUAGE,
		},
		wipLimit: numberValue(flow.wip_limit) || DEFAULT_WIP_LIMIT,
		cacheTtlSeconds: numberValue(flow.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
	};
};

const renderProjectConfig = (input: SetupProjectConfigInput, existingText = ""): string => {
	const apiUrl = input.apiUrl || DEFAULT_API_URL;
	const account = input.account || DEFAULT_ACCOUNT;
	const board = input.board || "";
	const flow = {
		columns: {
			todo: input.todoColumn || "",
			in_progress: input.inProgressColumn || "",
		},
		users: parseUsersInput(input.users || {}),
		card: {
			language: DEFAULT_FLOW_CARD_LANGUAGE,
		},
		wip_limit: DEFAULT_WIP_LIMIT,
		cache_ttl: DEFAULT_CACHE_TTL_SECONDS,
	} satisfies YamlObject;

	const existing = parseYaml(existingText);
	const mergedEntries = mergeFlowIntoConfig(existing, flow, account, board, apiUrl);
	return serializeYaml(mergedEntries);
};

const mergeFlowIntoConfig = (
	existing: YamlObject,
	flow: YamlObject,
	account: string,
	board: string,
	apiUrl: string,
): Array<[string, YamlValue]> => {
	const entries: Array<[string, YamlValue]> = [];
	const keys = new Set(Object.keys(existing));

	if (!keys.has("api_url")) {
		entries.push(["api_url", apiUrl]);
	}
	if (!keys.has("account")) {
		entries.push(["account", account]);
	}
	if (!keys.has("board")) {
		entries.push(["board", board]);
	}

	let hasFlow = false;
	for (const [key, value] of Object.entries(existing)) {
		if (key === "api_url") {
			entries.push([key, apiUrl]);
			continue;
		}
		if (key === "account") {
			entries.push([key, account]);
			continue;
		}
		if (key === "board") {
			entries.push([key, board]);
			continue;
		}
		if (key === "flow") {
			hasFlow = true;
			entries.push([key, mergeFlowConfig(objectValue(value), flow)]);
			continue;
		}
		entries.push([key, value]);
	}

	if (!hasFlow) {
		entries.push(["flow", flow]);
	}

	return entries;
};

const mergeFlowConfig = (current: YamlObject, next: YamlObject): YamlObject => {
	const currentColumns = objectValue(current.columns);
	const nextColumns = objectValue(next.columns);
	const nextUsers = objectValue(next.users);
	const currentCard = objectValue(current.card);
	const nextCard = objectValue(next.card);

	const cardLanguage =
		parseCardLanguage(currentCard) || parseCardLanguage(nextCard) || DEFAULT_FLOW_CARD_LANGUAGE;

	return {
		...current,
		columns: {
			todo: stringValue(nextColumns.todo) || stringValue(currentColumns.todo) || "",
			in_progress:
				stringValue(nextColumns.in_progress) || stringValue(currentColumns.in_progress) || "",
		},
		users: nextUsers,
		wip_limit: numberValue(next.wip_limit) || numberValue(current.wip_limit) || DEFAULT_WIP_LIMIT,
		cache_ttl:
			numberValue(next.cache_ttl) || numberValue(current.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
		card: {
			...currentCard,
			...nextCard,
			language: cardLanguage,
		},
	};
};

const parseCardLanguage = (value: unknown): FlowCardLanguage | undefined => {
	if (typeof value === "object" && value !== null) {
		const raw = (value as YamlObject).language;
		if (raw === "en" || raw === "mixed" || raw === "zh-CN") return raw;
	}

	return undefined;
};

const serializeYaml = (entries: Array<[string, YamlValue]>, indent = 0): string => {
	const lines = renderYamlEntries(entries, indent);
	lines.push("");
	return lines.join("\n");
};

const renderYamlEntries = (entries: Array<[string, YamlValue]>, indent: number): string[] => {
	const spaces = " ".repeat(indent);
	const lines: string[] = [];

	for (const [key, value] of entries) {
		const rendered = formatYamlValue(value, indent);
		if (rendered.startsWith("\n")) {
			lines.push(`${spaces}${key}:${rendered}`);
		} else {
			lines.push(`${spaces}${key}: ${rendered}`);
		}
	}

	return lines;
};

const formatYamlValue = (value: YamlValue, indent: number): string => {
	if (value === null || typeof value === "number" || typeof value === "boolean") {
		return JSON.stringify(value);
	}

	if (typeof value === "string") {
		return value;
	}

	if (Array.isArray(value)) {
		if (value.length === 0) return "[]";
		const itemIndent = indent + 2;
		const items = value.map((entry) => formatYamlArrayItem(entry, itemIndent));
		return `\n${items.join("\n")}`;
	}

	if (Object.keys(value).length === 0) {
		return "{}";
	}

	const lines = renderYamlEntries(Object.entries(value), indent + 2).join("\n");
	return `\n${lines}`;
};

const formatYamlArrayItem = (value: YamlValue, indent: number): string => {
	const spaces = " ".repeat(indent);
	const rendered = formatYamlValue(value, indent);
	if (rendered.startsWith("\n")) {
		return `${spaces}-\n${rendered.slice(1)}`;
	}
	return `${spaces}- ${rendered}`;
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
const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "_");

const dirname = (path: string): string => {
	const normalized = path.replace(/\/+$/, "");
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
};
