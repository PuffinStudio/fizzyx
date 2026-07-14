import { Effect } from "effect";
import { dirname, join } from "node:path";
import { ConfigRepo, type ConfigRepository } from "../ports/config-repository";
import type { Card } from "../domain/models";
import { resolveDraftDirectory } from "../adapters/git-dev-state";
import { markdownishText } from "../use-cases/flow-card-content";

export const FLOW_SKILL_FILE_PATH = join(".agents", "skills", "fizzyx", "SKILL.md");
export const FLOW_WORKFLOW_FILE_PATH = join(".agents", "skills", "fizzyx", "WORKFLOW.md");
export const FLOW_TEMPLATE_FILE_PATH = join(".agents", "skills", "fizzyx", "CARD_TEMPLATE.md");

export type FlowScaffoldFileAction = "created" | "skipped" | "overwritten";

export interface FlowScaffoldFileResult {
	readonly path: string;
	readonly action: FlowScaffoldFileAction;
}

export interface FlowDraftResult {
	readonly path: string;
}

export interface FlowDraftInput {
	readonly user?: string;
	readonly title?: string;
	readonly suggestedSkills?: ReadonlyArray<string>;
}

const resolveProjectRoot = (): Effect.Effect<string, Error, ConfigRepository> =>
	Effect.flatMap(ConfigRepo, (configRepo) =>
		configRepo.loadProjectConfigOptional().pipe(
			Effect.catchDefect(() => Effect.succeed(undefined)),
			Effect.catch(() => Effect.succeed(undefined)),
			Effect.map((projectConfig) => projectConfig?.rootDir ?? process.cwd()),
		),
	);

const readOptionalText = (path: string): Effect.Effect<string | undefined, Error> =>
	Effect.gen(function* () {
		const exists = yield* Effect.tryPromise({
			try: () => Bun.file(path).exists(),
			catch: (cause) => new Error(`failed to check ${path}: ${String(cause)}`),
		});

		if (!exists) {
			return undefined;
		}

		return yield* Effect.tryPromise({
			try: () => Bun.file(path).text(),
			catch: (cause) => new Error(`failed to read ${path}: ${String(cause)}`),
		});
	});

const ensureDirectory = (path: string): Effect.Effect<void, Error> =>
	Effect.tryPromise({
		try: () =>
			import("node:fs/promises").then((fs) =>
				fs.mkdir(dirname(path), {
					recursive: true,
					mode: 0o700,
				}),
			),
		catch: (cause) => new Error(`failed to create ${dirname(path)}: ${String(cause)}`),
	});

const writeText = (path: string, text: string): Effect.Effect<void, Error> =>
	Effect.tryPromise({
		try: () => Bun.write(path, text),
		catch: (cause) => new Error(`failed to write ${path}: ${String(cause)}`),
	});

const resolveFlowFile = (
	relativePath: string,
	loadBuiltIn: () => string,
): Effect.Effect<string, Error, ConfigRepository> =>
	Effect.gen(function* () {
		const root = yield* resolveProjectRoot();
		const absolutePath = join(root, relativePath);
		const local = yield* readOptionalText(absolutePath);
		if (local !== undefined) {
			return local;
		}

		return loadBuiltIn();
	});

export const loadFlowWorkflowContent = (): Effect.Effect<string, Error, ConfigRepository> =>
	resolveFlowFile(FLOW_WORKFLOW_FILE_PATH, () => getBuiltinWorkflow());

export const loadFlowSkillContent = (): Effect.Effect<string, Error, ConfigRepository> =>
	resolveFlowFile(FLOW_SKILL_FILE_PATH, getBuiltinSkill);

export const loadFlowTemplateContent = (): Effect.Effect<string, Error, ConfigRepository> =>
	resolveFlowFile(FLOW_TEMPLATE_FILE_PATH, () => getBuiltinTemplate());

export const createFlowDraft = (
	input: FlowDraftInput = {},
): Effect.Effect<FlowDraftResult, Error, ConfigRepository> =>
	Effect.gen(function* () {
		const template = yield* loadFlowTemplateContent();
		const content = renderFlowDraft(template, input);
		return yield* writeDraft("card", content);
	});

export const createCardEditDraft = (card: Card): Effect.Effect<FlowDraftResult, Error> => {
	const sections: string[] = [`# ${card.title}`, "## Tags"];
	if (card.tags?.length) sections.push(...card.tags.map((tag) => `- ${tag}`));
	const description = markdownishText(card.descriptionHtml || card.description || "");
	if (description) sections.push(description);
	sections.push(
		"## Steps",
		...(card.steps ?? []).map((step) => `- [${step.completed ? "x" : " "}] ${step.content}`),
	);
	return writeDraft(`card-${card.number}`, sections.join("\n\n"));
};

const writeDraft = (prefix: string, content: string): Effect.Effect<FlowDraftResult, Error> =>
	Effect.gen(function* () {
		const directory = yield* resolveDraftDirectory();
		for (let attempt = 0; attempt < 10; attempt += 1) {
			const filename = `${prefix}-${crypto.randomUUID().slice(0, 8)}.md`;
			const absolutePath = join(directory, filename);
			const exists = yield* Effect.tryPromise({
				try: () => Bun.file(absolutePath).exists(),
				catch: (cause) => new Error(`failed to check ${absolutePath}: ${String(cause)}`),
			});
			if (exists) continue;

			yield* ensureDirectory(absolutePath);
			yield* writeText(absolutePath, `${content}\n`);
			return { path: absolutePath };
		}

		return yield* Effect.fail(new Error("failed to create unique draft path"));
	});

const renderFlowDraft = (template: string, input: FlowDraftInput): string => {
	const sections: string[] = [];
	if (input.title?.trim()) sections.push(`# ${input.title.trim()}`);
	if (input.user?.trim()) sections.push(`## Assignee\n- ${input.user.trim()}`);

	const skills = uniqueList(input.suggestedSkills ?? []);
	const body = skills.length > 0 ? replaceSuggestedSkills(template, skills) : template;
	sections.push(body.trim());
	return sections.filter(Boolean).join("\n\n");
};

const replaceSuggestedSkills = (template: string, skills: ReadonlyArray<string>): string => {
	const lines = template.split(/\r?\n/);
	const headingIndex = lines.findIndex((line) => /^##\s+Suggested Skills\s*$/i.test(line.trim()));
	if (headingIndex === -1) {
		return `${template.trim()}\n\n## Suggested Skills\n${skills.map((skill) => `- ${skill}`).join("\n")}`;
	}

	let nextHeadingIndex = lines.length;
	for (let i = headingIndex + 1; i < lines.length; i += 1) {
		if (/^##\s+/.test(lines[i]?.trim() ?? "")) {
			nextHeadingIndex = i;
			break;
		}
	}

	return [
		...lines.slice(0, headingIndex + 1),
		...skills.map((skill) => `- ${skill}`),
		"",
		...lines.slice(nextHeadingIndex),
	].join("\n");
};

const uniqueList = (values: ReadonlyArray<string>): string[] =>
	Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

export const initFlowScaffold = ({
	force,
}: {
	force: boolean;
}): Effect.Effect<ReadonlyArray<FlowScaffoldFileResult>, Error, ConfigRepository> =>
	Effect.gen(function* () {
		const root = yield* resolveProjectRoot();
		const templates = [
			{
				path: FLOW_SKILL_FILE_PATH,
				content: getBuiltinSkill(),
			},
			{
				path: FLOW_WORKFLOW_FILE_PATH,
				content: getBuiltinWorkflow(),
			},
			{
				path: FLOW_TEMPLATE_FILE_PATH,
				content: getBuiltinTemplate(),
			},
		] as const;

		const results: Array<FlowScaffoldFileResult> = [];

		for (const template of templates) {
			const absolutePath = join(root, template.path);
			const exists = yield* Effect.tryPromise({
				try: () => Bun.file(absolutePath).exists(),
				catch: (cause) => new Error(`failed to check ${absolutePath}: ${String(cause)}`),
			});

			if (exists && !force) {
				results.push({ path: template.path, action: "skipped" });
				continue;
			}

			yield* ensureDirectory(absolutePath);
			yield* writeText(absolutePath, `${template.content}\n`);

			results.push({
				path: template.path,
				action: exists ? "overwritten" : "created",
			});
		}

		return results;
	});

export const formatFlowScaffoldResult = (result: FlowScaffoldFileResult): string =>
	`${result.action}: ${result.path}`;

const getBuiltinWorkflow = (): string =>
	[
		"## Workflow",
		"",
		"This is the default starter workflow. Customize a project-local policy by editing",
		"",
		"\t.agents/skills/fizzyx/WORKFLOW.md",
		"",
		"in your repository.",
		"",
		"## Setup",
		"- fizzyx init <board-id>",
		"- init creates or refreshes the FizzyX workflow section in the project AGENTS.md without installing skills",
		"- fizzyx auth status",
		"- fizzyx auth login <token>",
		"",
		"## Work Entry Point",
		"- Start each local cycle with `fizzyx flow work`.",
		"- Use `fizzyx flow list` for board filters and `fizzyx flow search` for full-text search.",
		"- Use `--json` on supported commands for an agent envelope with next-action breadcrumbs.",
		"- flow work returns board context, next recommended card, blockers, and the next action.",
		"- Before code edits, run `fizzyx dev status --agent`; inspect pre-existing files and use `fizzyx dev baseline accept` explicitly when they must remain.",
		"",
		"## Card Lifecycle",
		"- Custom columns are supported; normal flow commands never provision or rename columns.",
		"- BACKLOG/READY/IN PROGRESS/REVIEW are the optional bundled preset.",
		"- fizzyx flow columns — discover real column IDs and names",
		"- fizzyx flow create --draft",
		'- fill the returned draft path, then run fizzyx flow create "<title>" --desc <draft-path>',
		'- fizzyx flow create "<title>" --assign <user> --desc <draft-path> — create and assign when ownership is explicit',
		"- fizzyx flow edit <card> --draft — rebuild a standard draft from the remote card",
		'- fizzyx flow edit <card> --desc <draft-file> [--title "<title>"] — edit using the same standard draft format and synchronize steps',
		"- fizzyx flow assign <card> <user> — assign after creation",
		"- fizzyx flow comment <card> <body> — add a standardized note",
		"- fizzyx flow move <card> <column-id-or-name|maybe|not-now> — generic transition for custom boards and Fizzy system states",
		"- fizzyx flow start <card> — move to IN PROGRESS and self-assign",
		"- fizzyx flow review <card> — request review-ready state",
		"- fizzyx flow done <card> — close with execution evidence",
		"- fizzyx flow reopen <card> — reopen a closed card",
		"- fizzyx flow done <card> --complete-steps — optional flow-time guard before close",
		'- fizzyx flow block <card> "<reason>" — pause work due to dependency or input gap',
		'- fizzyx flow unblock <card> "<reason>" — resume in the configured default column',
		"- fizzyx flow untriage <card> — return a card to Fizzy Maybe/triage",
		"- fizzyx flow repair [--apply] — normalize legacy tags and checklist fields",
		"",
		"## Flow + Dev Loop",
		"- With a card: `fizzyx flow show <card>` → `fizzyx dev status --agent` → `fizzyx dev start <slug> --kind <kind> --card <card>`.",
		"- Before review: run `fizzyx dev ready --agent`, then `fizzyx flow review <card>`.",
		"- Before done: ensure the commit, branch, or accepted change is complete, then run `fizzyx flow done <card> <ref>`.",
		"- Without a card: use `fizzyx dev status --agent`, `fizzyx dev start <slug> --kind <kind>`, and `fizzyx dev ready --agent`.",
		"",
		"## Card Template",
		"- Use `fizzyx flow create --draft` and edit the returned Git-local or user-state path.",
		"- Do not create cards from plain text. `flow create --desc` expects this draft-shaped file.",
		"- The draft must keep `## Steps`; cards without steps are not valid execution cards.",
		"- `flow create` does not assign by default. Use `--assign <user>` only when ownership is explicit.",
		"- `flow edit --desc` requires the same draft shape and synchronizes the remote Fizzy steps.",
		"- Use `flow repair` for legacy normalization, not routine card editing.",
		"- Keep draft content project-agnostic and project-localized.",
		"- Delete the draft file after card creation succeeds.",
		"",
		"## Metadata",
		"- Use tags for stable facets only: priority, type, area, phase, depends_on, blocks.",
		"- `area` and `phase` values come from project vocabulary; read",
		"  `.fizzyx.yaml`, `AGENTS.md`, `CONTEXT.md`, and project docs before adding them.",
		"- Do not invent `area` or `phase` values without local project docs.",
		"- Keep mutable execution state in `## Steps`, `## Inputs Needed`,",
		"  or blocker commands and comments.",
		"",
		"## Skill Management",
		"- skill pins are managed by `fizzyx skill` commands only.",
		"- `fizzyx flow` may recommend skills but does not add/remove pins.",
		"",
		"## Planner",
		"- `fizzyx planner start` — visualization mode for board/work planning.",
		"- `fizzyx planner snapshot` — create immutable debugging snapshots.",
		"",
		"## Close Discipline",
		"- Never close cards through the UI.",
		"- close through `fizzyx flow` only.",
	].join("\n");

const getBuiltinSkill = (): string =>
	[
		"---",
		"name: fizzyx",
		"description: Manage project workflow with flow and manage skills with skill.",
		"triggers:",
		"  - fizzyx",
		"  - /fizzyx",
		"  - flow work",
		"  - flow columns",
		"  - flow list",
		"  - flow search",
		"  - flow create",
		"  - flow move",
		"  - flow comment",
		"  - flow start",
		"  - flow review",
		"  - flow done",
		"  - flow reopen",
		"  - flow unblock",
		"  - flow untriage",
		"  - flow repair",
		"  - flow block",
		"  - skill list",
		"  - my cards",
		"  - planner start",
		"  - planner snapshot",
		"invocable: true",
		'argument-hint: "[flow|skill|planner action] [args...]"',
		"---",
		"",
		"# fizzyx",
		"",
		"Use fizzyx flow for board workflow. The daily entry point is fizzyx flow work.",
		"Use fizzyx skill for project skill pins, updates, and health checks.",
		"Flow may recommend skills based on tags; it does not add or remove pins.",
		"",
		"## Workflow",
		"",
		"Flow is used for planning execution and day-to-day board movement.",
		"",
		"### Core loop",
		"- fizzyx flow work",
		"- fizzyx flow list",
		"- fizzyx flow search <query>",
		"- fizzyx flow columns",
		"- fizzyx dev status --agent",
		"- fizzyx flow create --draft",
		'- fizzyx flow create "<title>" --desc <draft-path>',
		"- fizzyx flow edit <card> --draft",
		'- fizzyx flow edit <card> --desc <draft-path> [--title "<title>"]',
		"- fizzyx flow assign <card> <user>",
		"- fizzyx flow comment <card> <body>",
		"- fizzyx flow show <card>",
		"- fizzyx flow move <card> <column-id-or-name>",
		"- fizzyx dev start <slug> --kind <kind> --card <card>",
		"- fizzyx flow start <card>",
		"- fizzyx dev ready --agent",
		"- fizzyx flow review <card>",
		"- fizzyx flow done <card> — close with execution evidence",
		"- fizzyx flow reopen <card>",
		"- fizzyx flow unblock <card> <reason>",
		"- fizzyx flow untriage <card>",
		'- fizzyx flow block <card> "<reason>"',
		"- fizzyx flow repair [--apply] — fix legacy metadata and steps",
		"",
		"Planner is limited to:",
		"- fizzyx planner start",
		"- fizzyx planner snapshot",
		"",
		"## Context Loading",
		"",
		"- Treat this skill as generic and project-neutral.",
		"- Do not hardcode board IDs, column IDs, user IDs, or local conventions.",
		"- Project context is loaded from .fizzyx.yaml.",
		"- Do not infer identity from git user, OS user, commit author, branch, or card assignee.",
		"- For identity-sensitive actions, run fizzyx auth status first.",
		"- For project-specific semantics, inspect AGENTS.md, CONTEXT.md, and",
		"  local workflow docs before creating or moving cards.",
		"- The CLI reads .fizzyx.yaml automatically from the current repository.",
		"  If machine auth is missing, run fizzyx init <board-id> first.",
		"- `fizzyx flow` owns cards. `fizzyx dev` owns Git branches, checks, promotion, and cleanup.",
		"",
		"## Metadata",
		"",
		"- Create cards from the standard draft only: first `fizzyx flow create --draft`,",
		'  then fill it and run `fizzyx flow create "<title>" --desc <draft-file>`.',
		"- Do not pipe plain text into `flow create`; the draft's `## Steps` section is required.",
		"- New cards are unassigned unless `--assign <user>` is provided. Use `flow assign <card> <user>` later when ownership becomes clear.",
		"- Use tags for stable metadata only: priority, type, area, phase,",
		"  depends_on, blocks.",
		"- area and phase are project-defined. Verify values from .fizzyx.yaml,",
		"  AGENTS.md, CONTEXT.md, and local docs before inventing them.",
		"- Mutable execution state belongs in ## Steps, ## Inputs Needed, and blocker",
		"  commands/comments, not tags.",
		"- Avoid status tags outside stable metadata fields.",
		"",
		"## Suggested Skills",
		"",
		"- Use flow recommendations from each card, then pin through top-level fizzyx skill.",
		"",
		"## Close Discipline",
		"",
		"- Do not close cards through the web UI.",
		"- Close through CLI commands only.",
		"- Preserve a single execution source of truth in Fizzy cards.",
		"",
		"## Commands",
		"",
		"commands:",
		"fizzyx auth status",
		"fizzyx flow work",
		"fizzyx flow list [--indexed-by <lane>] [--search <terms>] [--json]",
		"fizzyx flow search <query> [--all-boards] [--json]",
		"fizzyx flow columns",
		"fizzyx dev status --agent",
		"fizzyx dev baseline show",
		"fizzyx dev baseline accept",
		"fizzyx flow start <card>",
		"fizzyx flow show <card>",
		"fizzyx dev start <slug> --kind <kind> --card <card>",
		"fizzyx dev ready --agent",
		"fizzyx flow create --draft",
		'fizzyx flow create "<title>" --desc <file|->',
		'fizzyx flow create "<title>" --assign <user> --desc <file|->',
		'fizzyx flow edit <card> --desc <file|-> [--title "<title>"]',
		"fizzyx flow assign <card> <user>",
		"fizzyx flow comment <card> <body> [--json]",
		"fizzyx flow move <card> <column-id-or-name>",
		"fizzyx flow repair --apply",
		'fizzyx flow done <card> "commit <sha>: <subject>"',
		"fizzyx flow reopen <card> [--json]",
		"fizzyx flow done <card> --complete-steps",
		'fizzyx flow block <card> "<reason>"',
		"fizzyx flow unblock <card> <reason> [--json]",
		"fizzyx flow untriage <card> [--json]",
		"fizzyx flow doctor",
		"fizzyx planner snapshot",
		"fizzyx planner start",
		"fizzyx skill list",
		"fizzyx skill init --project",
		"fizzyx skill init --global",
		"fizzyx skill add <source>",
		"fizzyx skill remove <name>",
		"fizzyx skill update [name] [--global]",
		"fizzyx skill info <name>",
		"fizzyx skill run <name>",
		"fizzyx skill doctor",
		"fizzyx skill migrate",
		"",
		"## Cards",
		"- fizzyx flow create --draft",
		'- fizzyx flow create "<title>" --desc <draft-path>',
		"- fizzyx flow edit <card> --draft",
		'- fizzyx flow edit <card> --desc <draft-path> [--title "<title>"]',
		"- fizzyx flow assign <card> <user>",
		"- fizzyx flow show <card>",
		"- fizzyx flow move <card> <column-id-or-name>",
		"- fizzyx flow repair [--apply]",
		'- fizzyx flow block <card> "<reason>"',
	].join("\n");

const getBuiltinTemplate = (): string =>
	`## Tags
- priority:p2
- type:chore
- area:<project-area>
- phase:<project-phase>

## Goal
What outcome this card should deliver.

## Context
- Important background context and assumptions.

## Acceptance Criteria
- [ ] User-visible behavior
- [ ] Error/empty/loading behavior
- [ ] Regression coverage

## Inputs Needed
- Design/API/product inputs

## Constraints
- Architectural/security/performance constraints.
- Do not persist mutable execution state as tags.

## Suggested Skills
- tdd

## Plan
- Confirm scope and blockers.
- Implement with minimal surface area.
- Verify and document before closure.

## Steps

- [ ] Confirm goal, context, and constraints
- [ ] Add or update implementation files
- [ ] Validate checks and run fizzyx flow done`;
