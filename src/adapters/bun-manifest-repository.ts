import { Effect } from "effect";
import { FileError } from "../domain/errors";
import type { SyncManifest } from "../domain/models";
import type { ManifestRepository } from "../ports/manifest-repository";

const MANIFEST_VERSION = 1 as const;

export const makeBunManifestRepository = (projectDir: string): ManifestRepository => {
	const manifestPath = () => `${projectDir}/.fizzyx/oss-manifest.json`;

	const read: ManifestRepository["read"] = () =>
		Effect.tryPromise({
			try: async () => {
				const file = Bun.file(manifestPath());
				if (!(await file.exists())) return null;
				const text = await file.text();
				if (!text.trim()) return null;
				return JSON.parse(text) as SyncManifest;
			},
			catch: (cause) =>
				new FileError({
					message: `Failed to read manifest: ${String(cause)}`,
					path: manifestPath(),
				}),
		});

	const write: ManifestRepository["write"] = (manifest) =>
		Effect.tryPromise({
			try: async () => {
				const dir = dirname(manifestPath());
				const fs = await import("node:fs/promises");
				await fs.mkdir(dir, { recursive: true });
				await Bun.write(manifestPath(), `${JSON.stringify(manifest, null, 2)}\n`);
			},
			catch: (cause) =>
				new FileError({
					message: `Failed to write manifest: ${String(cause)}`,
					path: manifestPath(),
				}),
		});

	return { read, write, path: manifestPath };
};

const dirname = (p: string): string => {
	const normalized = p.replace(/\/+$/, "");
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
};

export const makeEmptyManifest = (localDir: string, remotePrefix: string): SyncManifest => ({
	version: MANIFEST_VERSION,
	localDir,
	remotePrefix,
	lastSyncedAt: new Date().toISOString(),
	files: {},
});
