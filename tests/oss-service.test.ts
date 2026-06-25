import { Effect } from "effect";
import { expect, test } from "bun:test";
import { getOssSecretName, ossInitBlank, DEFAULT_OSS_ENV } from "../src/use-cases/oss-service";
import type { ConfigRepository } from "../src/ports/config-repository";
import type { ProjectConfig } from "../src/domain/models";
import { ConfigError, FileError } from "../src/domain/errors";
import { ConfigRepo } from "../src/ports/config-repository";

const makeConfig = (overrides: Partial<ProjectConfig> = {}): ProjectConfig =>
	({
		apiUrl: "https://example.com",
		account: "1",
		board: "board-1",
		configPath: "/tmp/.fizzy.yaml",
		rootDir: "/tmp",
		...overrides,
	}) as ProjectConfig;

test("getOssSecretName returns a deterministic hash per project+env", () => {
	const config = makeConfig();
	const name1 = getOssSecretName(config, "prod");
	const name2 = getOssSecretName(config, "prod");
	expect(name1).toBe(name2);

	const nameDev = getOssSecretName(config, "dev");
	expect(nameDev).not.toBe(name1);
});

test("getOssSecretName different project roots produce different hashes", () => {
	const configA = makeConfig({ rootDir: "/project-a", board: undefined } as unknown as Record<
		string,
		unknown
	>);
	const configB = makeConfig({ rootDir: "/project-b", board: undefined } as unknown as Record<
		string,
		unknown
	>);
	expect(getOssSecretName(configA, "prod")).not.toBe(getOssSecretName(configB, "prod"));
});

test("DEFAULT_OSS_ENV is 'default'", () => {
	expect(DEFAULT_OSS_ENV).toBe("default");
});

test("ossInitBlank returns false when oss section already exists", async () => {
	const configRepo: ConfigRepository = {
		loadProjectConfig: () => Effect.fail(new ConfigError({ message: "not mocked" })),
		loadProjectConfigOptional: () =>
			Effect.succeed(
				makeConfig({
					oss: {
						environments: {
							prod: {
								endpoint: "https://example.com",
								region: "us-east-1",
								accessKeyId: "AKID",
								secretAccessKey: "SAK",
							},
						},
						sync: {
							localDir: "./public",
							concurrency: 10,
						},
					},
				}) as ProjectConfig,
			),
		setupProjectConfig: () => Effect.fail(new FileError({ message: "not mocked", path: "" })),
		loadCredentials: () => Effect.fail(new FileError({ message: "not mocked", path: "" })),
		migrateCredentialsFromOfficial: () => Effect.fail(new FileError({ message: "not mocked" })),
		saveCredentials: () => Effect.succeed(undefined),
		deleteCredentials: () => Effect.succeed(undefined),
		setupOssConfig: () => Effect.fail(new FileError({ message: "not mocked", path: "" })),
		setupOpenApiConfig: () => Effect.fail(new FileError({ message: "not mocked", path: "" })),
	};

	const result = await Effect.runPromise(
		ossInitBlank().pipe(Effect.provideService(ConfigRepo, configRepo)),
	);
	expect(result).toBe(false);
});
