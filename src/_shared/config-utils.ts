import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseYaml } from "../adapters/config-codec";
import { ConfigError, FileError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";

export type ConfigContext = {
	rootDir: string;
	sourcePath?: string;
	writePath: string;
	document: Record<string, unknown>;
};

export const loadConfigContext = (): ConfigContext => {
	let dir = process.cwd();

	while (true) {
		const primary = join(dir, CONFIG_FILE);
		if (existsSync(primary)) {
			return {
				rootDir: dir,
				sourcePath: primary,
				writePath: primary,
				document: readYaml(primary),
			};
		}

		const legacy = join(dir, LEGACY_CONFIG_FILE);
		if (existsSync(legacy)) {
			return {
				rootDir: dir,
				sourcePath: legacy,
				writePath: join(dir, CONFIG_FILE),
				document: readYaml(legacy),
			};
		}

		const parent = dirname(dir);
		if (parent === dir) {
			return {
				rootDir: process.cwd(),
				writePath: join(process.cwd(), CONFIG_FILE),
				document: {},
			};
		}

		dir = parent;
	}
};

export const readYaml = (path: string): Record<string, unknown> => {
	try {
		return objectValue(parseYaml(readFileSync(path, "utf-8")));
	} catch (cause) {
		if (cause instanceof ConfigError) throw cause;
		throw new FileError({
			message: `Failed to read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
			path,
		});
	}
};

export const writeYaml = (path: string, document: Record<string, unknown>): void => {
	try {
		writeFileSync(path, `${Bun.YAML.stringify(document, null, 2)}`);
	} catch (cause) {
		throw new FileError({
			message: `Failed to write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
			path,
		});
	}
};

export const ensureSkillsSection = (document: Record<string, unknown>): Record<string, unknown> => {
	const current = objectValue(document.skills);
	const next: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(current)) {
		next[key] = value;
	}

	return next;
};

export const objectValue = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

export const numberValue = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;
