import type { Effect } from "effect";
import type { ConfigError, FileError } from "../domain/errors";
import type { InitializedProjectConfig, ProjectConfig } from "../domain/models";
import type { Credentials } from "../domain/models";

export interface ConfigRepository {
	loadProjectConfig: () => Effect.Effect<ProjectConfig, ConfigError | FileError>;
	loadProjectConfigOptional: () => Effect.Effect<
		ProjectConfig | undefined,
		ConfigError | FileError
	>;
	setupProjectConfig: (
		input: SetupProjectConfigInput,
	) => Effect.Effect<InitializedProjectConfig, FileError>;
	loadCredentials: (profile: string) => Effect.Effect<Credentials, FileError>;
	migrateCredentialsFromOfficial: (profile: string) => Effect.Effect<Credentials, FileError>;
	saveCredentials: (profile: string, credentials: Credentials) => Effect.Effect<void, FileError>;
	deleteCredentials: (profile: string) => Effect.Effect<void, FileError>;
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
