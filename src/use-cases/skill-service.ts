import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ConfigError, FileError, ValidationError } from "../domain/errors";
import { CONFIG_FILE, LEGACY_CONFIG_FILE } from "../ports/config-repository";
import { parseYaml } from "../adapters/config-codec";
import { applySkillsMigration, inspectSkillsMigration } from "./migrate";
import codebaseDesignContent from "../skills/bundled/codebase-design.md" with { type: "text" };
import diagnoseContent from "../skills/bundled/diagnose.md" with { type: "text" };
import handoffContent from "../skills/bundled/handoff.md" with { type: "text" };
import improveCodebaseContent from "../skills/bundled/improve-codebase.md" with { type: "text" };
import securityReviewContent from "../skills/bundled/security-review.md" with { type: "text" };
import tddContent from "../skills/bundled/tdd.md" with { type: "text" };
import toIssuesContent from "../skills/bundled/to-issues.md" with { type: "text" };
import toPrdContent from "../skills/bundled/to-prd.md" with { type: "text" };
import triageContent from "../skills/bundled/triage.md" with { type: "text" };

const BUILTIN_SKILL_VERSION = "1.0.0";

type BuiltinSkill = {
	name: string;
	description: string;
	runHint: string;
	content: string;
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
	status: "project" | "bundled";
};

const BUILTIN_SKILLS: ReadonlyArray<BuiltinSkill> = [
	{
		name: "codebase-design",
		description: "Map the current architecture before changing it.",
		runHint:
			"Run `codebase-design` by reading the skill instructions before changing architecture.",
		content: codebaseDesignContent,
	},
	{
		name: "diagnose",
		description: "Debug failing behavior with a structured diagnosis pass.",
		runHint: "Run `diagnose` by gathering the failure, hypothesis, and verification steps first.",
		content: diagnoseContent,
	},
	{
		name: "handoff",
		description: "Prepare a concise handoff for the next worker.",
		runHint: "Run `handoff` by summarizing status, risks, and concrete next actions.",
		content: handoffContent,
	},
	{
		name: "improve-codebase",
		description: "Identify pragmatic improvements in the existing codebase.",
		runHint: "Run `improve-codebase` by auditing hotspots before proposing changes.",
		content: improveCodebaseContent,
	},
	{
		name: "security-review",
		description: "Review auth, input handling, and boundary risks.",
		runHint: "Run `security-review` before shipping auth, secrets, or user-input changes.",
		content: securityReviewContent,
	},
	{
		name: "tdd",
		description: "Write the failing test first and drive implementation from it.",
		runHint: "Run `tdd` before implementation: write a failing test, confirm RED, then implement.",
		content: tddContent,
	},
	{
		name: "to-issues",
		description: "Split a plan into directly actionable issues.",
		runHint: "Run `to-issues` to turn the current plan into small actionable work items.",
		content: toIssuesContent,
	},
	{
		name: "to-prd",
		description: "Turn the current problem statement into a project brief.",
		runHint: "Run `to-prd` to produce a concise product or implementation brief.",
		content: toPrdContent,
	},
	{
		name: "triage",
		description: "Sort incoming issues and route them to the right workflow state.",
		runHint: "Run `triage` to classify the issue before implementation starts.",
		content: triageContent,
	},
];

const BUILTIN_BY_NAME = new Map(BUILTIN_SKILLS.map((skill) => [skill.name, skill] as const));
const MATT_POCOCK_ALIASES: Readonly<Record<string, string>> = {
	"improve-codebase-architecture": "improve-codebase",
	diagnosing: "diagnose",
	"diagnosing-bugs": "diagnose",
};

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
			status: installedMeta ? "project" : "bundled",
		});
	}

	for (const [name, meta] of Object.entries(installed)) {
		if (results.has(name)) continue;
		results.set(name, {
			name,
			source: meta.source,
			version: meta.version,
			status: "project",
		});
	}

	return [...results.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const addSkill = (source: string): SkillSummary => {
	const builtin = resolveBuiltinSkill(source);
	if (!builtin) {
		throw new ValidationError({
			message: `Unsupported skill source: ${source}. Bundled skills are available without download; use a bundled name such as tdd or mattpocock/tdd.`,
		});
	}

	const context = loadConfigContext();
	const skills = ensureSkillsSection(context.document);
	const installed = objectValue(skills.installed);
	installed[builtin.name] = {
		source: "builtin",
		version: BUILTIN_SKILL_VERSION,
	};
	skills.version = 1;
	skills.installed = installed;
	context.document.skills = skills;
	writeYaml(context.writePath, context.document);

	return {
		name: builtin.name,
		source: "builtin",
		version: BUILTIN_SKILL_VERSION,
		status: "project",
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
				status: "project" as const,
			}
		: undefined;

	if (summary) {
		const skills = ensureSkillsSection(context.document);
		const nextInstalled = objectValue(skills.installed);
		delete nextInstalled[name];
		skills.version = 1;
		if (Object.keys(nextInstalled).length > 0) {
			skills.installed = nextInstalled;
		} else {
			delete skills.installed;
		}
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
			status: "project",
		};
	}

	const builtin = BUILTIN_BY_NAME.get(name);
	if (builtin) {
		return {
			name,
			source: "builtin",
			version: BUILTIN_SKILL_VERSION,
			status: "bundled",
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
		return `Run \`${name}\` from project skill metadata.`;
	}

	throw new ValidationError({ message: `Unknown skill: ${name}` });
};

export const doctorSkillConfig = (): string => {
	const report = inspectSkillsMigration();
	const versionLine = report.skillsVersion === 1 ? "project pins: ready" : "project pins: optional";
	return `${versionLine}\nbundled skills: ready`;
};

export const updateSkills = (name?: string): string => {
	if (!name) {
		for (const skill of BUILTIN_SKILLS) {
			writeBundledSkill(loadConfigContext(), skill);
		}
		return `refreshed ${BUILTIN_SKILLS.length} bundled skills from this fizzyx release.`;
	}

	const builtin = resolveBuiltinSkill(name);
	if (builtin) {
		writeBundledSkill(loadConfigContext(), builtin);
		return `refreshed bundled skill ${builtin.name} at ${BUILTIN_SKILL_VERSION}.`;
	}

	const info = getSkillInfo(name);
	return `Skill ${name} is project-pinned from ${info.source}; bundled refresh is not available.`;
};

export const migrateSkills = (mode: "check" | "apply"): string => {
	if (mode === "apply") {
		const before = inspectSkillsMigration();
		const after = applySkillsMigration();
		return before.needsSkillsVersion
			? `Recorded skills.version: 1 in ${after.writePath}.`
			: `Skills config ready: ${after.writePath}.`;
	}

	const report = inspectSkillsMigration();
	return report.needsSkillsVersion
		? `Bundled skills are ready. Project pins are optional.`
		: `Skills config ready: ${report.writePath}.`;
};

const resolveBuiltinSkill = (source: string): BuiltinSkill | undefined => {
	const direct = BUILTIN_BY_NAME.get(source);
	if (direct) return direct;
	const mattPreset = source.match(/^mattpocock\/(.+)$/);
	if (!mattPreset?.[1]) return undefined;
	return BUILTIN_BY_NAME.get(MATT_POCOCK_ALIASES[mattPreset[1]] ?? mattPreset[1]);
};

const writeBundledSkill = (context: ConfigContext, skill: BuiltinSkill): void => {
	const skillDir = join(context.rootDir, ".agents", "skills", skill.name);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), skill.content);
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
