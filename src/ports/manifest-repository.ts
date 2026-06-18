import { Context, type Effect } from "effect";
import type { FileError } from "../domain/errors";
import type { SyncManifest } from "../domain/models";

export interface ManifestRepository {
	read: () => Effect.Effect<SyncManifest | null, FileError>;
	write: (manifest: SyncManifest) => Effect.Effect<void, FileError>;
	path: () => string;
}

export const ManifestRepo = Context.Service<ManifestRepository>("ManifestRepo");
