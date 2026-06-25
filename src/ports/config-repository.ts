import type { Effect } from "effect";
import { Context } from "effect";
import type { ConfigError, FileError } from "../domain/errors";
import type {
	Credentials,
	InitializedProjectConfig,
	OssConfig,
	OssEnvironmentConfig,
	OssEnvironmentName,
	ProjectConfig,
} from "../domain/models";
import type { OpenApiGenConfig } from "../domain/openapi-models";

/** The well-known project config filename convention */
export const CONFIG_FILE = ".fizzyx.yaml";

/** Legacy fallback config filename for backwards compatibility */
export const LEGACY_CONFIG_FILE = ".fizzy.yaml";

export interface ConfigRepository {
	loadProjectConfig: () => Effect.Effect<ProjectConfig, ConfigError | FileError>;
	loadProjectConfigOptional: () => Effect.Effect<
		ProjectConfig | undefined,
		ConfigError | FileError
	>;
	setupProjectConfig: (
		input: SetupProjectConfigInput,
	) => Effect.Effect<InitializedProjectConfig, FileError>;
	setupOssConfig: (input: OssSetupInput) => Effect.Effect<OssConfig, FileError>;
	setupOpenApiConfig: (input: OpenApiSetupInput) => Effect.Effect<void, FileError>;
	loadCredentials: (profile: string) => Effect.Effect<Credentials, FileError>;
	migrateCredentialsFromOfficial: (profile: string) => Effect.Effect<Credentials, FileError>;
	saveCredentials: (profile: string, credentials: Credentials) => Effect.Effect<void, FileError>;
	deleteCredentials: (profile: string) => Effect.Effect<void, FileError>;
}

export interface OpenApiSetupInput {
	entry: OpenApiGenConfig;
	force?: boolean;
	configPath?: string;
}

export interface SetupProjectConfigInput {
	account?: string;
	board?: string;
	list?: boolean;
	todoColumn?: string;
	inProgressColumn?: string;
	users?: Record<string, string>;
	apiUrl?: string;
	configPath?: string;
}

export const ConfigRepo = Context.Service<ConfigRepository>("ConfigRepo");

export interface OssSetupInput {
	env: OssEnvironmentName;
	config: OssEnvironmentConfig;
	sync: {
		localDir: string;
		remotePrefix?: string;
		concurrency?: number;
	};
	configPath?: string;
}
