import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
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
import codingStandardsContent from "../skills/bundled/coding-standards.md" with { type: "text" };
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
import contextFormatContent from "../skills/bundled/resources/domain-modeling/CONTEXT-FORMAT.md" with { type: "text" };
import adrFormatContent from "../skills/bundled/resources/domain-modeling/ADR-FORMAT.md" with { type: "text" };
import htmlReportContent from "../skills/bundled/resources/improve-codebase/HTML-REPORT.md" with { type: "text" };
import logicPrototypeContent from "../skills/bundled/resources/prototype/LOGIC.md" with { type: "text" };
import uiPrototypeContent from "../skills/bundled/resources/prototype/UI.md" with { type: "text" };
import agentBriefContent from "../skills/bundled/resources/triage/AGENT-BRIEF.md" with { type: "text" };
import outOfScopeContent from "../skills/bundled/resources/triage/OUT-OF-SCOPE.md" with { type: "text" };
import { BUNDLED_OPENAI_METADATA } from "../skills/bundled/openai-metadata";

// Matt-derived content checked against mattpocock/skills@66898f6 (2026-07-13).
// The bundle version also covers FizzyX-authored skills.
const BUILTIN_SKILL_VERSION = "1.5.0";

type BuiltinSkill = {
	name: string;
	description: string;
	runHint: string;
	content: string;
	resources?: Readonly<Record<string, string>>;
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
		name: "coding-standards",
		description: "Apply repository-aware style, quality, naming, and tool-use standards.",
		runHint:
			"Run `coding-standards` while implementing or reviewing code: inspect repository rules first, then verify naming, quality, tool use, and required checks.",
		content: codingStandardsContent,
	},
	{
		name: "dev-workflow",
		description: "Apply branch-first, guard-railed delivery with fizzyx dev commands.",
		runHint:
			"Run `dev-workflow`: create Fizzy cards via `fizzyx flow create --draft`, assign only with `--assign` or `flow assign`, then use `fizzyx dev status --agent`, branch, sync, checkpoint, and ready checks before completion.",
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
		resources: {
			"CONTEXT-FORMAT.md": contextFormatContent,
			"ADR-FORMAT.md": adrFormatContent,
		},
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
		resources: { "LOGIC.md": logicPrototypeContent, "UI.md": uiPrototypeContent },
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
		resources: { "HTML-REPORT.md": htmlReportContent },
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
		resources: {
			"AGENT-BRIEF.md": agentBriefContent,
			"OUT-OF-SCOPE.md": outOfScopeContent,
		},
	},
];

const BUILTIN_BY_NAME = new Map(BUILTIN_SKILLS.map((skill) => [skill.name, skill] as const));
const BUNDLE_ALIASES: Readonly<Record<string, string>> = {
	"git-workflow": "dev-workflow",
	"agent-git": "dev-workflow",
	"code-style": "coding-standards",
	"code-quality": "coding-standards",
	naming: "coding-standards",
	"tool-usage": "coding-standards",
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
	writeBundledSkill(context.rootDir, builtin, true);

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
	const context = loadConfigContext();
	const installed = parseInstalledSkills(context.document);
	const missing = Object.keys(installed).filter((name) => {
		const builtin = BUILTIN_BY_NAME.get(name);
		return builtin
			? !isBundledSkillComplete(context.rootDir, builtin)
			: !existsSync(join(context.rootDir, ".agents", "skills", name, "SKILL.md"));
	});
	const stale = Object.entries(installed)
		.filter(
			([name, metadata]) =>
				metadata.source === "builtin" &&
				BUILTIN_BY_NAME.has(name) &&
				metadata.version !== BUILTIN_SKILL_VERSION,
		)
		.map(([name]) => name);
	const versionLine = report.skillsVersion === 1 ? "project pins: ready" : "project pins: optional";
	const filesLine =
		missing.length === 0
			? "project skill files: ready"
			: `project skill files: missing ${missing.join(", ")} (run fizzyx skill update)`;
	const pinVersionLine =
		stale.length === 0
			? "project pin versions: ready"
			: `project pin versions: stale ${stale.join(", ")} (run fizzyx skill update)`;
	return `${versionLine}\n${pinVersionLine}\n${filesLine}\nbundled skills: ready`;
};

export type SkillInstallScope = "project" | "global";

const skillRoot = (scope: SkillInstallScope, context: ConfigContext): string =>
	scope === "global" ? process.env.HOME || homedir() : context.rootDir;

export const initSkills = (scope: SkillInstallScope): string => {
	const context = loadConfigContext();
	const root = skillRoot(scope, context);
	let changed = 0;
	for (const skill of BUILTIN_SKILLS) {
		if (writeBundledSkill(root, skill, false)) changed += 1;
	}
	const location = scope === "global" ? "~/.agents/skills" : ".agents/skills";
	return `initialized ${changed} bundled skill(s) in ${location}; ${BUILTIN_SKILLS.length - changed} already present.`;
};

export const updateSkills = (name?: string, scope: SkillInstallScope = "project"): string => {
	const context = loadConfigContext();
	const root = skillRoot(scope, context);

	if (!name) {
		for (const skill of BUILTIN_SKILLS) {
			writeBundledSkill(root, skill, true);
		}
		if (scope === "project")
			refreshProjectPins(
				context,
				BUILTIN_SKILLS.map((skill) => skill.name),
			);
		return `refreshed ${BUILTIN_SKILLS.length} bundled skills in ${scope} scope from this fizzyx release.`;
	}

	const builtin = resolveBuiltinSkill(name);
	if (builtin) {
		writeBundledSkill(root, builtin, true);
		if (scope === "project") refreshProjectPins(context, [builtin.name]);
		return `refreshed bundled skill ${builtin.name} at ${BUILTIN_SKILL_VERSION} in ${scope} scope.`;
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

const writeBundledSkill = (root: string, skill: BuiltinSkill, overwrite: boolean): boolean => {
	const skillDir = join(root, ".agents", "skills", skill.name);
	const openaiMetadata = BUNDLED_OPENAI_METADATA[skill.name];
	const files: Record<string, string> = {
		"SKILL.md": skill.content,
		...skill.resources,
		...(openaiMetadata ? { "agents/openai.yaml": openaiMetadata } : {}),
	};
	let changed = false;
	for (const [relativePath, content] of Object.entries(files)) {
		const outputPath = resolveArtifactPath(skillDir, relativePath);
		if (!overwrite && existsSync(outputPath)) continue;
		mkdirSync(dirname(outputPath), { recursive: true });
		const temporaryPath = `${outputPath}.tmp-${process.pid}`;
		writeFileSync(temporaryPath, content);
		renameSync(temporaryPath, outputPath);
		changed = true;
	}
	return changed;
};

const bundledSkillPaths = (skill: BuiltinSkill): ReadonlyArray<string> => [
	"SKILL.md",
	...Object.keys(skill.resources ?? {}),
	...(BUNDLED_OPENAI_METADATA[skill.name] ? ["agents/openai.yaml"] : []),
];

const isBundledSkillComplete = (root: string, skill: BuiltinSkill): boolean => {
	const skillDir = join(root, ".agents", "skills", skill.name);
	return bundledSkillPaths(skill).every((relativePath) =>
		existsSync(resolveArtifactPath(skillDir, relativePath)),
	);
};

const resolveArtifactPath = (skillDir: string, relativePath: string): string => {
	if (isAbsolute(relativePath)) {
		throw new ValidationError({
			message: `Bundled skill artifact path must be relative: ${relativePath}`,
		});
	}
	const root = resolve(skillDir);
	const outputPath = resolve(root, relativePath);
	if (outputPath !== root && !outputPath.startsWith(`${root}${sep}`)) {
		throw new ValidationError({
			message: `Bundled skill artifact escapes its skill directory: ${relativePath}`,
		});
	}
	return outputPath;
};

const refreshProjectPins = (context: ConfigContext, names: ReadonlyArray<string>): void => {
	const skills = ensureSkillsSection(context.document);
	const installed = objectValue(skills.installed);
	let changed = false;
	for (const name of names) {
		const item = objectValue(installed[name]);
		if (stringValue(item.source) !== "builtin") continue;
		if (stringValue(item.version) === BUILTIN_SKILL_VERSION) continue;
		installed[name] = { ...item, version: BUILTIN_SKILL_VERSION };
		changed = true;
	}
	if (!changed) return;
	skills.installed = installed;
	context.document.skills = skills;
	writeYaml(context.writePath, context.document);
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
