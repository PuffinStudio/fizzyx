import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applySkillsMigration, inspectSkillsMigration } from "./migrate";
import {
	type ConfigContext,
	ensureSkillsSection,
	loadConfigContext,
	objectValue,
	writeYaml,
} from "../_shared/config-utils";
import { ValidationError } from "../domain/errors";
import codebaseDesignContent from "../skills/bundled/codebase-design.md" with { type: "text" };
import devWorkflowContent from "../skills/bundled/dev-workflow.md" with { type: "text" };
import codeReviewContent from "../skills/bundled/code-review.md" with { type: "text" };
import diagnoseContent from "../skills/bundled/diagnosing-bugs.md" with { type: "text" };
import domainModelingContent from "../skills/bundled/domain-modeling.md" with { type: "text" };
import prototypeContent from "../skills/bundled/prototype.md" with { type: "text" };
import researchContent from "../skills/bundled/research.md" with { type: "text" };
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
		name: "dev-workflow",
		description: "Apply branch-first, guard-railed delivery with fizzyx dev commands.",
		runHint:
			"Run `dev-workflow` and follow branch, sync, checkpoint, and ready checks before completion.",
		content: devWorkflowContent,
	},
	{
		name: "code-review",
		description: "Review changes since a fixed point along Standards and Spec axes.",
		runHint:
			"Run `code-review` with a commit, branch, or tag to review the diff against standards and spec.",
		content: codeReviewContent,
	},
	{
		name: "diagnosing-bugs",
		description: "Debug failing behavior with a structured diagnosis pass.",
		runHint:
			"Run `diagnosing-bugs` by gathering the failure, hypothesis, and verification steps first.",
		content: diagnoseContent,
	},
	{
		name: "domain-modeling",
		description: "Build and sharpen a project's domain model with glossary and ADRs.",
		runHint:
			"Run `domain-modeling` to establish shared language and capture architectural decisions.",
		content: domainModelingContent,
	},
	{
		name: "handoff",
		description: "Prepare a concise handoff for the next worker.",
		runHint: "Run `handoff` by summarizing status, risks, and concrete next actions.",
		content: handoffContent,
	},
	{
		name: "prototype",
		description: "Build a throwaway prototype to answer a design question.",
		runHint: "Run `prototype` to build throwaway code that answers a question about logic or UI.",
		content: prototypeContent,
	},
	{
		name: "research",
		description: "Investigate a question against high-trust primary sources.",
		runHint: "Run `research` to investigate a question and capture findings as a Markdown file.",
		content: researchContent,
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
const BUNDLE_ALIASES: Readonly<Record<string, string>> = {
	"git-workflow": "dev-workflow",
	"agent-git": "dev-workflow",
	diagnose: "diagnosing-bugs",
	diagnosing: "diagnosing-bugs",
};
const MATT_POCOCK_ALIASES: Readonly<Record<string, string>> = {
	"improve-codebase-architecture": "improve-codebase",
	diagnose: "diagnosing-bugs",
	diagnosing: "diagnosing-bugs",
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
	const builtin = resolveBuiltinSkill(name);
	const canonicalName = builtin?.name ?? name;
	const installed = parseInstalledSkills(context.document);
	const summary = installed[canonicalName]
		? {
				name: canonicalName,
				source: installed[canonicalName].source,
				version: installed[canonicalName].version,
				status: "project" as const,
			}
		: undefined;

	if (summary) {
		const skills = ensureSkillsSection(context.document);
		const nextInstalled = objectValue(skills.installed);
		delete nextInstalled[canonicalName];
		skills.version = 1;
		if (Object.keys(nextInstalled).length > 0) {
			skills.installed = nextInstalled;
		} else {
			delete skills.installed;
		}
		context.document.skills = skills;
		writeYaml(context.writePath, context.document);
	}

	const skillDir = join(context.rootDir, ".agents", "skills", canonicalName);
	if (existsSync(skillDir)) {
		rmSync(skillDir, { recursive: true, force: true });
	}

	return {
		removed: summary !== undefined || !existsSync(skillDir),
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

	const builtin = resolveBuiltinSkill(name);
	if (builtin) {
		const canonicalInstalledMeta = installed[builtin.name];
		if (canonicalInstalledMeta) {
			return {
				name: builtin.name,
				source: canonicalInstalledMeta.source,
				version: canonicalInstalledMeta.version,
				status: "project",
			};
		}

		return {
			name: builtin.name,
			source: "builtin",
			version: BUILTIN_SKILL_VERSION,
			status: "bundled",
		};
	}

	throw new ValidationError({ message: `Unknown skill: ${name}` });
};

export const runSkill = (name: string): string => {
	const builtin = resolveBuiltinSkill(name);
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
	const context = loadConfigContext();

	if (!name) {
		for (const skill of BUILTIN_SKILLS) {
			writeBundledSkill(context, skill);
		}
		return `refreshed ${BUILTIN_SKILLS.length} bundled skills from this fizzyx release.`;
	}

	const builtin = resolveBuiltinSkill(name);
	if (builtin) {
		writeBundledSkill(context, builtin);
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
	const alias = BUNDLE_ALIASES[source];
	if (alias) {
		return BUILTIN_BY_NAME.get(alias);
	}
	const mattPreset = source.match(/^mattpocock\/(.+)$/);
	if (!mattPreset?.[1]) return undefined;
	return BUILTIN_BY_NAME.get(MATT_POCOCK_ALIASES[mattPreset[1]] ?? mattPreset[1]);
};

const writeBundledSkill = (context: ConfigContext, skill: BuiltinSkill): void => {
	const skillDir = join(context.rootDir, ".agents", "skills", skill.name);
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(join(skillDir, "SKILL.md"), skill.content);
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

const stringValue = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;
