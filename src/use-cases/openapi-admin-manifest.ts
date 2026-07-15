import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";
import type { GeneratedFile } from "../domain/openapi-models";
import type { AdminFramework, AdminPackageManager } from "./openapi-admin-scaffold";

const MANIFEST_PATH = ".fizzyx/admin-manifest.json";

interface AdminManifest {
	version: 1;
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	specFingerprint: string;
	specSource?: string;
	files: Record<string, string>;
}

export interface AdminManifestMetadata {
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	specFingerprint: string;
	specSource?: string;
}

export interface AdminWriteResult {
	written: string[];
	conflicts: string[];
	deleted: string[];
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
		return parsed.version === 1 && parsed.files ? parsed : undefined;
	} catch {
		return undefined;
	}
};

export const readAdminManifestMetadata = (root: string): AdminManifestMetadata | undefined => {
	const manifest = loadManifest(root);
	if (!manifest) return undefined;
	return {
		framework: manifest.framework,
		packageManager: manifest.packageManager,
		specFingerprint: manifest.specFingerprint,
		specSource: manifest.specSource,
	};
};

export const writeAdminGeneratedFiles = (
	root: string,
	files: GeneratedFile[],
	metadata: AdminManifestMetadata,
): AdminWriteResult => {
	const previous = loadManifest(root);
	const nextHashes: Record<string, string> = { ...previous?.files };
	const result: AdminWriteResult = { written: [], conflicts: [], deleted: [] };
	const incoming = new Set(files.map((file) => safeRelativePath(file.path)));

	for (const [relative, previousHash] of Object.entries(previous?.files ?? {})) {
		if (incoming.has(relative)) continue;
		const fullPath = join(root, safeRelativePath(relative));
		if (!existsSync(fullPath)) {
			delete nextHashes[relative];
			continue;
		}
		if (hash(readFileSync(fullPath, "utf8")) !== previousHash) {
			result.conflicts.push(relative);
			continue;
		}
		unlinkSync(fullPath);
		delete nextHashes[relative];
		result.deleted.push(relative);
	}

	for (const file of files) {
		const relative = safeRelativePath(file.path);
		const fullPath = join(root, relative);
		const previousHash = previous?.files[relative];
		if (existsSync(fullPath)) {
			const currentHash = hash(readFileSync(fullPath, "utf8"));
			if (previousHash ? currentHash !== previousHash : currentHash !== hash(file.content)) {
				result.conflicts.push(relative);
				continue;
			}
		}
		mkdirSync(dirname(fullPath), { recursive: true });
		writeFileSync(fullPath, file.content);
		nextHashes[relative] = hash(file.content);
		result.written.push(relative);
	}

	const manifest: AdminManifest = {
		version: 1,
		framework: metadata.framework,
		packageManager: metadata.packageManager,
		specFingerprint: metadata.specFingerprint,
		specSource: metadata.specSource ?? previous?.specSource,
		files: nextHashes,
	};
	const manifestPath = join(root, MANIFEST_PATH);
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	return result;
};

export const refreshAdminGeneratedFileHashes = (root: string, paths: string[]): void => {
	const manifest = loadManifest(root);
	if (!manifest) return;
	for (const path of paths) {
		const relative = safeRelativePath(path);
		const fullPath = join(root, relative);
		if (manifest.files[relative] && existsSync(fullPath)) {
			manifest.files[relative] = hash(readFileSync(fullPath, "utf8"));
		}
	}
	writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, "\t")}\n`);
};
