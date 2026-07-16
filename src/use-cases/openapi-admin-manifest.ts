import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { GeneratedFile } from "../domain/openapi-models";
import type { AdminFramework, AdminPackageManager } from "./openapi-admin-scaffold";

const MANIFEST_PATH = ".fizzyx/admin-manifest.json";
const GENERATOR_VERSION = "1.2.0";
const TEMPLATE_VERSION = 2;

interface AdminManifestV1 {
	version: 1;
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	specFingerprint: string;
	specSource?: string;
	preset?: string;
	createMode?: "page" | "dialog";
	files: Record<string, string>;
}

interface AdminManifestFile {
	ownership: "generated" | "seed-once";
	baseHash: string;
	generatedHash: string;
}

interface AdminManifestV2 {
	version: 2;
	generatorVersion: string;
	templateVersion: number;
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	appliedSpecFingerprint: string | null;
	pendingSpecFingerprint: string | null;
	adminPlanSnapshot: unknown;
	specSource?: string;
	preset?: string;
	createMode?: "page" | "dialog";
	files: Record<string, AdminManifestFile>;
}

type AdminManifest = AdminManifestV1 | AdminManifestV2;

export interface AdminManifestMetadata {
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	specFingerprint: string;
	specSource?: string;
	preset?: string;
	createMode?: "page" | "dialog";
	generatorVersion?: string;
	templateVersion?: number;
	adminPlanSnapshot?: unknown;
}

export interface AdminWriteResult {
	written: string[];
	conflicts: string[];
	deleted: string[];
}

export interface AdminManifestSnapshot {
	appliedFingerprint: string | null;
	pendingFingerprint: string | null;
	adminPlanSnapshot: unknown;
	files: Record<string, AdminManifestFile>;
}

const hash = (content: string): string =>
	new Bun.CryptoHasher("sha256").update(content).digest("hex");

const safeRelativePath = (path: string): string => {
	const normalized = normalize(path).replaceAll("\\", "/");
	if (isAbsolute(path) || normalized === ".." || normalized.startsWith("../")) {
		throw new Error(`generated file path escapes project: ${path}`);
	}
	return normalized;
};

const loadManifest = (root: string): AdminManifest | undefined => {
	const path = join(root, MANIFEST_PATH);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as AdminManifest;
		if (parsed.version === 1 && parsed.files) return parsed;
		if (parsed.version === 2 && parsed.files) return parsed;
		return undefined;
	} catch {
		return undefined;
	}
};

const manifestFiles = (manifest: AdminManifest | undefined): Record<string, AdminManifestFile> =>
	Object.fromEntries(
		Object.entries(manifest?.files ?? {}).map(([path, entry]) => {
			const previousHash = typeof entry === "string" ? entry : entry.baseHash;
			return [
				path,
				{
					ownership: typeof entry === "string" ? "generated" : entry.ownership,
					baseHash: previousHash,
					generatedHash: typeof entry === "string" ? entry : entry.generatedHash,
				},
			];
		}),
	);

const appliedFingerprint = (manifest: AdminManifest | undefined): string | null => {
	if (!manifest) return null;
	return manifest.version === 1 ? manifest.specFingerprint : manifest.appliedSpecFingerprint;
};

export const readAdminManifestSnapshot = (root: string): AdminManifestSnapshot => {
	const manifest = loadManifest(root);
	return {
		appliedFingerprint: appliedFingerprint(manifest),
		pendingFingerprint: manifest?.version === 2 ? manifest.pendingSpecFingerprint : null,
		adminPlanSnapshot: manifest?.version === 2 ? manifest.adminPlanSnapshot : null,
		files: manifestFiles(manifest),
	};
};

export const preflightAdminGeneratedFiles = (
	root: string,
	files: GeneratedFile[],
): AdminWriteResult => {
	const previousFiles = manifestFiles(loadManifest(root));
	const normalizedFiles = files.map((file) => ({ ...file, path: safeRelativePath(file.path) }));
	const incoming = new Set(normalizedFiles.map((file) => file.path));
	const conflicts = new Set<string>();
	const written: string[] = [];
	const deleted: string[] = [];

	for (const [relative, entry] of Object.entries(previousFiles)) {
		if (incoming.has(relative) || entry.ownership === "seed-once") continue;
		const fullPath = join(root, safeRelativePath(relative));
		if (existsSync(fullPath) && hash(readFileSync(fullPath, "utf8")) !== entry.baseHash)
			conflicts.add(relative);
		else if (existsSync(fullPath)) deleted.push(relative);
	}
	for (const file of normalizedFiles) {
		const previous = previousFiles[file.path];
		if (previous?.ownership === "seed-once") continue;
		const fullPath = join(root, file.path);
		if (!existsSync(fullPath)) {
			written.push(file.path);
			continue;
		}
		const currentHash = hash(readFileSync(fullPath, "utf8"));
		const previousHash = previous?.baseHash;
		if (currentHash !== (previousHash ?? hash(file.content))) conflicts.add(file.path);
		else if (currentHash !== hash(file.content)) written.push(file.path);
	}
	return { written: written.sort(), conflicts: [...conflicts].sort(), deleted: deleted.sort() };
};

const writeManifest = (root: string, manifest: AdminManifestV2): void => {
	const manifestPath = join(root, MANIFEST_PATH);
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

export const readAdminManifestMetadata = (root: string): AdminManifestMetadata | undefined => {
	const manifest = loadManifest(root);
	if (!manifest) return undefined;
	const specFingerprint = appliedFingerprint(manifest);
	if (specFingerprint === null) return undefined;
	return {
		framework: manifest.framework,
		packageManager: manifest.packageManager,
		specFingerprint,
		specSource: manifest.specSource,
		preset: manifest.preset,
		createMode: manifest.createMode,
		...(manifest.version === 2
			? {
					generatorVersion: manifest.generatorVersion,
					templateVersion: manifest.templateVersion,
					adminPlanSnapshot: manifest.adminPlanSnapshot,
				}
			: {}),
	};
};

export const writeAdminGeneratedFiles = (
	root: string,
	files: GeneratedFile[],
	metadata: AdminManifestMetadata,
	options: { deferAppliedFingerprint?: boolean } = {},
): AdminWriteResult => {
	const previous = loadManifest(root);
	const previousFiles = manifestFiles(previous);
	const nextFiles = { ...previousFiles };
	const result: AdminWriteResult = { written: [], conflicts: [], deleted: [] };
	const normalizedFiles = files.map((file) => ({ ...file, path: safeRelativePath(file.path) }));
	const incoming = new Set(normalizedFiles.map((file) => file.path));
	const conflicts = new Set<string>();

	// Preflight the complete change set so a late conflict cannot leave a partially updated tree.
	for (const [relative, entry] of Object.entries(previousFiles)) {
		if (incoming.has(relative) || entry.ownership === "seed-once") continue;
		const fullPath = join(root, safeRelativePath(relative));
		if (existsSync(fullPath) && hash(readFileSync(fullPath, "utf8")) !== entry.baseHash) {
			conflicts.add(relative);
		}
	}
	for (const file of normalizedFiles) {
		if (previousFiles[file.path]?.ownership === "seed-once") continue;
		const fullPath = join(root, file.path);
		if (!existsSync(fullPath)) continue;
		const currentHash = hash(readFileSync(fullPath, "utf8"));
		const previousHash = previousFiles[file.path]?.baseHash;
		if (currentHash !== (previousHash ?? hash(file.content))) conflicts.add(file.path);
	}

	const commonManifest = {
		version: 2 as const,
		generatorVersion:
			metadata.generatorVersion ??
			(previous?.version === 2 ? previous.generatorVersion : GENERATOR_VERSION),
		templateVersion:
			metadata.templateVersion ??
			(previous?.version === 2 ? previous.templateVersion : TEMPLATE_VERSION),
		framework: metadata.framework,
		packageManager: metadata.packageManager,
		adminPlanSnapshot:
			options.deferAppliedFingerprint || conflicts.size > 0
				? previous?.version === 2
					? previous.adminPlanSnapshot
					: null
				: (metadata.adminPlanSnapshot ??
					(previous?.version === 2 ? previous.adminPlanSnapshot : null)),
		specSource: metadata.specSource ?? previous?.specSource,
		preset: metadata.preset ?? previous?.preset,
		createMode: metadata.createMode ?? previous?.createMode,
	};

	if (conflicts.size > 0) {
		result.conflicts = [...conflicts].sort();
		writeManifest(root, {
			...commonManifest,
			appliedSpecFingerprint: appliedFingerprint(previous),
			pendingSpecFingerprint: metadata.specFingerprint,
			files: nextFiles,
		});
		return result;
	}

	for (const [relative, entry] of Object.entries(previousFiles)) {
		if (incoming.has(relative) || entry.ownership === "seed-once") continue;
		const fullPath = join(root, safeRelativePath(relative));
		if (existsSync(fullPath)) {
			unlinkSync(fullPath);
			result.deleted.push(relative);
		}
		delete nextFiles[relative];
	}

	for (const file of normalizedFiles) {
		const fullPath = join(root, file.path);
		const previousEntry = previousFiles[file.path];
		if (previousEntry?.ownership === "seed-once") continue;
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, file.content);
		const generatedHash = hash(file.content);
		nextFiles[file.path] = {
			ownership: file.ownership ?? "generated",
			baseHash: generatedHash,
			generatedHash,
		};
		result.written.push(file.path);
	}

	writeManifest(root, {
		...commonManifest,
		appliedSpecFingerprint: options.deferAppliedFingerprint
			? appliedFingerprint(previous)
			: metadata.specFingerprint,
		pendingSpecFingerprint: options.deferAppliedFingerprint ? metadata.specFingerprint : null,
		files: nextFiles,
	});
	return result;
};

/** Finalizes a previously staged sync after quality checks have passed. */
export const commitAdminManifestApplied = (
	root: string,
	fingerprint: string,
	adminPlanSnapshot: unknown,
): void => {
	const manifest = loadManifest(root);
	if (!manifest || manifest.version !== 2)
		throw new Error("admin manifest v2 is required to commit sync");
	if (manifest.pendingSpecFingerprint !== fingerprint)
		throw new Error("pending admin fingerprint does not match sync candidate");
	writeManifest(root, {
		...manifest,
		appliedSpecFingerprint: fingerprint,
		pendingSpecFingerprint: null,
		adminPlanSnapshot,
	});
};

export const refreshAdminGeneratedFileHashes = (root: string, paths: string[]): void => {
	const manifest = loadManifest(root);
	if (!manifest) return;
	if (manifest.version === 1) {
		for (const path of paths) {
			const relative = safeRelativePath(path);
			const fullPath = join(root, relative);
			if (manifest.files[relative] && existsSync(fullPath)) {
				manifest.files[relative] = hash(readFileSync(fullPath, "utf8"));
			}
		}
	} else {
		for (const path of paths) {
			const relative = safeRelativePath(path);
			const fullPath = join(root, relative);
			if (manifest.files[relative] && existsSync(fullPath)) {
				manifest.files[relative].baseHash = hash(readFileSync(fullPath, "utf8"));
			}
		}
	}
	writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
};
