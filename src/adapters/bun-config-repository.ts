import { Effect, Layer } from "effect";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { ConfigError, FileError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { OFFICIAL_CONFIG_FILE } from "./app-paths";
import type { Credentials, InitializedProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import type { OpenApiSetupInput } from "../ports/config-repository";
import { isTaggedError } from "../_shared/helpers";
import {
	parseCredentialsJson,
	parseOfficialConfig,
	parseOssConfig,
	parseProjectConfig,
	parseYaml,
	renderOpenApiConfig,
	renderOssConfig,
	renderProjectConfig,
} from "./config-codec";

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

	setupOpenApiConfig: (input: OpenApiSetupInput) =>
		Effect.gen(function* () {
			const path = input.configPath || `${process.cwd()}/${CONFIG_FILE}`;
			const existingText = yield* readOptionalText(path);
			const config = renderOpenApiConfig(input, existingText);
			yield* writeText(path, config, 0o600);
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
	readText(path).pipe(Effect.map((text) => parseCredentialsJson(text, path)));

const loadOfficialCredentials = (profile: string): Effect.Effect<Credentials, FileError> =>
	Effect.gen(function* () {
		const path = yield* officialConfigPath();
		const text = yield* readText(path);
		const raw = parseOfficialConfig(text, path);

		const configAccount = raw.account;
		if (configAccount !== profile) {
			return yield* new FileError({
				message: `No matching official credential for account ${profile}`,
				path,
			});
		}

		const token = raw.token;
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

const isNoTokenError = (error: FileError, path: string): boolean =>
	error.message === `No token in ${path}`;

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9_.-]/g, "_");
