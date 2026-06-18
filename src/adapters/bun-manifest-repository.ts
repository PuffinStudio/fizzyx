import { Effect, Layer } from "effect";
import { dirname } from "node:path";
import { FileError } from "../domain/errors";
import type { SyncManifest } from "../domain/models";
import type { ManifestRepository } from "../ports/manifest-repository";
import { ManifestRepo } from "../ports/manifest-repository";
import { ConfigRepo } from "../ports/config-repository";

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

export const makeEmptyManifest = (localDir: string, remotePrefix: string): SyncManifest => ({
	version: MANIFEST_VERSION,
	localDir,
	remotePrefix,
	lastSyncedAt: new Date().toISOString(),
	files: {},
});

export const Live = Layer.effect(
	ManifestRepo,
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* configRepo.loadProjectConfig();
		return makeBunManifestRepository(config.rootDir);
	}),
);
