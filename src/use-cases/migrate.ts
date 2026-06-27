import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigError, FileError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { parseYaml } from "../adapters/config-codec";

export type SkillsMigrationReport = {
	writePath: string;
	lockFilePath: string;
	lockFileExists: boolean;
	skillsVersion?: number;
	needsSkillsVersion: boolean;
};

type ConfigContext = {
	rootDir: string;
	sourcePath?: string;
	writePath: string;
	document: Record<string, unknown>;
};

export const inspectSkillsMigration = (): SkillsMigrationReport => {
	const context = loadConfigContext();
	const skills = objectValue(context.document.skills);
	const version = numberValue(skills.version);
	const lockFilePath = join(context.rootDir, "skills.lock.json");

	return {
		writePath: context.writePath,
		lockFilePath,
		lockFileExists: existsSync(lockFilePath),
		skillsVersion: version,
		needsSkillsVersion: version !== 1,
	};
};

export const applySkillsMigration = (): SkillsMigrationReport => {
	const context = loadConfigContext();
	const report = inspectSkillsMigration();

	if (!report.needsSkillsVersion) {
		return report;
	}

	const skills = ensureSkillsSection(context.document);
	skills.version = 1;
	context.document.skills = skills;
	writeYaml(context.writePath, context.document);

	return inspectSkillsMigration();
};

const loadConfigContext = (): ConfigContext => {
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

const readYaml = (path: string): Record<string, unknown> => {
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

const writeYaml = (path: string, document: Record<string, unknown>): void => {
	try {
		writeFileSync(path, `${Bun.YAML.stringify(document, null, 2)}`);
	} catch (cause) {
		throw new FileError({
			message: `Failed to write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
			path,
		});
	}
};

const ensureSkillsSection = (document: Record<string, unknown>): Record<string, unknown> => {
	const current = objectValue(document.skills);
	const next: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(current)) {
		next[key] = value;
	}

	return next;
};

const objectValue = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const numberValue = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;
