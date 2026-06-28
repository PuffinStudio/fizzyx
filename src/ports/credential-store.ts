import type { Effect } from "effect";
import { Context } from "effect";
import type { FileError } from "../domain/errors";

export interface CredentialStore {
	get: (service: string, account: string) => Effect.Effect<string | undefined, FileError>;
	set: (service: string, account: string, credential: string) => Effect.Effect<void, FileError>;
	delete: (service: string, account: string) => Effect.Effect<void, FileError>;
}

export const CredentialStoreService = Context.Service<CredentialStore>("CredentialStore");
