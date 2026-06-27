import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigError, FileError, ValidationError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { parseYaml } from "../adapters/config-codec";
import { applySkillsMigration, inspectSkillsMigration } from "./migrate";

const BUILTIN_SKILL_VERSION = "1.0.0";

type BuiltinSkill = {
	name: string;
	description: string;
	runHint: string;
};

type ConfigContext = {
	rootDir: string;
	sourcePath?: string;
	writePath: string;
	document: Record<string, unknown>;
};

export type SkillSummary = {
	name: string;
	source: string;
	version?: string;
	status: "installed" | "available";
};

const BUILTIN_SKILLS: ReadonlyArray<BuiltinSkill> = [
	{
		name: "codebase-design",
		description: "Map the current architecture before changing it.",
		runHint:
			"Run `codebase-design` by reading the skill instructions before changing architecture.",
	},
	{
		name: "diagnose",
		description: "Debug failing behavior with a structured diagnosis pass.",
		runHint: "Run `diagnose` by gathering the failure, hypothesis, and verification steps first.",
	},
	{
		name: "handoff",
		description: "Prepare a concise handoff for the next worker.",
		runHint: "Run `handoff` by summarizing status, risks, and concrete next actions.",
	},
	{
		name: "improve-codebase",
		description: "Identify pragmatic improvements in the existing codebase.",
		runHint: "Run `improve-codebase` by auditing hotspots before proposing changes.",
	},
	{
		name: "security-review",
		description: "Review auth, input handling, and boundary risks.",
		runHint: "Run `security-review` before shipping auth, secrets, or user-input changes.",
	},
	{
		name: "tdd",
		description: "Write the failing test first and drive implementation from it.",
		runHint: "Run `tdd` before implementation: write a failing test, confirm RED, then implement.",
	},
	{
		name: "to-issues",
		description: "Split a plan into directly actionable issues.",
		runHint: "Run `to-issues` to turn the current plan into small actionable work items.",
	},
	{
		name: "to-prd",
		description: "Turn the current problem statement into a project brief.",
		runHint: "Run `to-prd` to produce a concise product or implementation brief.",
	},
	{
		name: "triage",
		description: "Sort incoming issues and route them to the right workflow state.",
		runHint: "Run `triage` to classify the issue before implementation starts.",
	},
];

const BUILTIN_BY_NAME = new Map(BUILTIN_SKILLS.map((skill) => [skill.name, skill] as const));

export const listSkills = (): ReadonlyArray<SkillSummary> => {
	const context = loadConfigContext();
	const installed = parseInstalledSkills(context.document);
	const results = new Map<string, SkillSummary>();

	for (const builtin of BUILTIN_SKILLS) {
		const installedMeta = installed[builtin.name];
		results.set(builtin.name, {
			name: builtin.name,
			source: installedMeta?.source ?? "builtin",
			version: installedMeta?.version ?? BUILTIN_SKILL_VERSION,
			status: installedMeta ? "installed" : "available",
		});
	}

	for (const [name, meta] of Object.entries(installed)) {
		if (results.has(name)) continue;
		results.set(name, {
			name,
			source: meta.source,
			version: meta.version,
			status: "installed",
		});
	}

	return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const addSkill = (source: string): SkillSummary => {
	const builtin = BUILTIN_BY_NAME.get(source);
	if (!builtin) {
		throw new ValidationError({
			message: `Unsupported skill source: ${source}. Only built-in skills are supported in this 1.0 baseline.`,
		});
	}

	const context = loadConfigContext();
	const skills = ensureSkillsSection(context.document);
	const installed = objectValue(skills.installed);
	installed[source] = {
		source: "builtin",
		version: BUILTIN_SKILL_VERSION,
	};
	skills.version = 1;
	skills.installed = installed;
	context.document.skills = skills;
	writeYaml(context.writePath, context.document);

	return {
		name: source,
		source: "builtin",
		version: BUILTIN_SKILL_VERSION,
		status: "installed",
	};
};

export const removeSkill = (
	name: string,
): { removed: boolean; deletedPath?: string; summary?: SkillSummary } => {
	const context = loadConfigContext();
	const installed = parseInstalledSkills(context.document);
	const summary = installed[name]
		? {
				name,
				source: installed[name].source,
				version: installed[name].version,
				status: "installed" as const,
			}
		: undefined;

	if (summary) {
		const skills = ensureSkillsSection(context.document);
		const nextInstalled = objectValue(skills.installed);
		delete nextInstalled[name];
		skills.version = 1;
		skills.installed = nextInstalled;
		context.document.skills = skills;
		writeYaml(context.writePath, context.document);
	}

	const skillDir = join(context.rootDir, ".agents", "skills", name);
	if (existsSync(skillDir)) {
		rmSync(skillDir, { recursive: true, force: true });
	}

	return {
		removed: summary !== undefined || existsSync(skillDir) === false,
		deletedPath: skillDir,
		summary,
	};
};

export const getSkillInfo = (name: string): SkillSummary => {
	const installed = parseInstalledSkills(loadConfigContext().document);
	const installedMeta = installed[name];
	if (installedMeta) {
		return {
			name,
			source: installedMeta.source,
			version: installedMeta.version,
			status: "installed",
		};
	}

	const builtin = BUILTIN_BY_NAME.get(name);
	if (builtin) {
		return {
			name,
			source: "builtin",
			version: BUILTIN_SKILL_VERSION,
			status: "available",
		};
	}

	throw new ValidationError({ message: `Unknown skill: ${name}` });
};

export const runSkill = (name: string): string => {
	const builtin = BUILTIN_BY_NAME.get(name);
	if (builtin) {
		return builtin.runHint;
	}

	const installed = parseInstalledSkills(loadConfigContext().document);
	const installedMeta = installed[name];
	if (installedMeta) {
		return `Run \`${name}\` by loading the installed skill metadata from source \`${installedMeta.source}\`.`;
	}

	throw new ValidationError({ message: `Unknown skill: ${name}` });
};

export const doctorSkillConfig = (): string => {
	const report = inspectSkillsMigration();
	const versionLine = report.skillsVersion === 1 ? "skills.version: 1" : "skills.version: missing";
	const lockLine = report.lockFileExists
		? `skills.lock.json present at ${report.lockFilePath}`
		: "no skills.lock.json";

	return `${versionLine}\n${lockLine}`;
};

export const updateSkills = (name?: string): string => {
	if (!name) {
		return "Built-in skills are up to date.";
	}

	const info = getSkillInfo(name);
	if (info.source === "builtin") {
		return `${name} is already up to date at ${info.version ?? BUILTIN_SKILL_VERSION}.`;
	}

	return `Skill ${name} uses source ${info.source}. Remote updates are not implemented in this 1.0 baseline.`;
};

export const migrateSkills = (mode: "check" | "apply"): string => {
	if (mode === "apply") {
		const before = inspectSkillsMigration();
		const after = applySkillsMigration();
		return before.needsSkillsVersion
			? `Migration applied at ${after.writePath}; skills.version set to 1; no skills.lock.json.`
			: `Skills config is already up to date at ${after.writePath}; no skills.lock.json.`;
	}

	const report = inspectSkillsMigration();
	return report.needsSkillsVersion
		? `skills.version missing in ${report.writePath}; run with --apply to add version 1; no skills.lock.json.`
		: `Skills config is up to date at ${report.writePath}; no skills.lock.json.`;
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

const parseInstalledSkills = (
	document: Record<string, unknown>,
): Record<string, { source: string; version?: string }> => {
	const installed = objectValue(objectValue(document.skills).installed);
	const result: Record<string, { source: string; version?: string }> = {};

	for (const [name, value] of Object.entries(installed)) {
		const item = objectValue(value);
		const source = stringValue(item.source);
		if (!source) continue;
		const version = stringValue(item.version);
		result[name] = version ? { source, version } : { source };
	}

	return result;
};

const objectValue = (value: unknown): Record<string, unknown> =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};

const stringValue = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
