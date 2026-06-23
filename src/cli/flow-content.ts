import { Effect } from "effect";
import { dirname, join } from "node:path";
import { ConfigRepo, type ConfigRepository } from "../ports/config-repository";

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

export const createFlowDraft = (): Effect.Effect<FlowDraftResult, Error, ConfigRepository> =>
	Effect.gen(function* () {
		const root = yield* resolveProjectRoot();
		const content = yield* loadFlowTemplateContent();

		for (let attempt = 0; attempt < 10; attempt += 1) {
			const filename = `card-${crypto.randomUUID().slice(0, 8)}.md`;
			const relativePath = join(".fizzyx", filename);
			const absolutePath = join(root, relativePath);
			const exists = yield* Effect.tryPromise({
				try: () => Bun.file(absolutePath).exists(),
				catch: (cause) => new Error(`failed to check ${absolutePath}: ${String(cause)}`),
			});
			if (exists) continue;

			yield* ensureDirectory(absolutePath);
			yield* writeText(absolutePath, `${content}\n`);
			return { path: relativePath };
		}

		return yield* Effect.fail(new Error("failed to create unique draft path"));
	});

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
		"- fizzyx setup <board-id>",
		"- fizzyx auth login <token>",
		"- fizzyx auth status",
		"",
		"## Create",
		"- fizzyx flow template --draft",
		"- edit card content and steps in .fizzyx/card-<random>.md",
		'- fizzyx flow add <user> "<title>" --desc .fizzyx/card-<random>.md',
		"- delete .fizzyx/card-<random>.md after the card is created",
		"- Use a unique random suffix so multiple agents do not collide.",
		"",
		"## Workflow",
		"Cards move through workflow columns, then close into Done state.",
		"",
		"- fizzyx flow start <card> — moves card from TODO to IN PROGRESS, self-assigns",
		"- fizzyx flow done <card> — closes into Done, auto-detects git ref, comments",
		'- fizzyx flow done <card> "commit <sha>: <subject>" — with explicit ref',
		"",
		"## Daily",
		"- fizzyx flow mine --fresh",
		"- fizzyx flow start <card>",
		"- fizzyx flow show <card>",
		"",
		"## Work",
		"- Inspect task goal and constraints",
		"- Draft clear implementation steps",
		"- Implement changes",
		"- Verify tests and acceptance criteria",
		"",
		"## Complete",
		"- fizzyx flow complete-steps <card>   — mark all pending steps done (required before done)",
		"- fizzyx flow done <card>             — closes into Done and writes comment (ref auto-detected from git)",
		'- fizzyx flow done <card> "message"   — with explicit ref',
		"- flow done requires all steps complete; otherwise it fails with an error listing unfinished steps.",
		"",
		"## Block",
		'- fizzyx flow block <card> "<reason>"',
		"- Use fizzyx flow comment-template <kind> for manual comments, and keep comments concise.",
		"",
		"## Card structure",
		"- Description stores context",
		"- Steps become Fizzy checklist items",
		"",
		"## Close discipline",
		"- Never close cards through the web UI.",
		"- Close only via CLI:",
		"  1) fizzyx flow complete-steps <card>",
		"  2) fizzyx flow done <card>",
		"",
	].join("\n");

const getBuiltinSkill = (): string => `---
name: fizzyx
description: Manage this repository's board through fizzyx flow commands.
triggers:
  - fizzyx
  - /fizzyx
  - create card
  - close card
  - move card
  - assign card
  - add comment
  - add step
  - my cards
  - my tasks
  - board status
  - card workflow
invocable: true
argument-hint: "[flow action] [args...]"
---

# fizzyx

Use fizzyx flow ... for board workflow. Do not use the legacy official CLI
for project workflow. If fizzyx flow lacks an operation, stop and ask.

## Workflow

Cards move through workflow columns, then close into **Done** state.

| Phase | Command | Action |
|-------|---------|--------|
| Start | fizzyx flow start <card> | Move TODO → IN PROGRESS, self-assign |
| Steps | fizzyx flow complete-steps <card> | Mark all pending steps done |
| Done | fizzyx flow done <card> "commit <sha>: <subject>" | Close into Done, comment |

**Never** close a card directly without flow done.

## Context Loading

- Treat this skill as generic. Do not hardcode board IDs, column IDs, users,
  scopes, title formats, or assignment rules here.
- Project data comes from .fizzy.yaml, the repo's AGENTS.md, and local
  workflow docs referenced by AGENTS.md.
- The CLI reads .fizzy.yaml automatically from the current repository.
- Before creating or assigning cards, inspect the project's local tracking rules
  instead of guessing from this skill.
- If project context is missing, run fizzyx setup <board-id> for machine
  config, then create or update a local project workflow doc such as
  docs/fizzy-workflow.md and link it from AGENTS.md.

## Project Workflow Doc

Keep project-specific board details out of this skill. Put them in a local doc
near the repo's other docs, usually docs/fizzy-workflow.md.

Minimum sections:

- Install/auth/setup commands.
- Board/account/API/cache context.
- Column meanings and IDs.
- Card title formats and allowed scopes.
- Assignment rules and user IDs.
- Local delivery rules that differ from fizzyx flow workflow.

If any of these facts are unknown, ask before creating cards that depend on
them.

## Identity

- my work, my cards, and my tasks mean the authenticated fizzyx user.
- Do not infer identity from git user, OS user, commit author, branch, or card assignee.
- For identity-sensitive requests, run fizzyx auth status first.
- Then run fizzyx flow mine --fresh.
- Use fizzyx flow status --fresh only as extra board context.

## Commands

commands:
fizzyx auth status
fizzyx flow workflow
fizzyx flow status --fresh
fizzyx flow mine --fresh
fizzyx flow show <card>
fizzyx flow start <card>
fizzyx flow template
fizzyx flow add <user> "<title>" --desc <file|->
fizzyx flow comment-template <done|blocked|unblocked|handoff|note>
fizzyx flow complete-steps <card>
fizzyx flow done <card> "commit <sha>: <subject>"
fizzyx flow block <card> "<reason>"
fizzyx flow std <card>
fizzyx flow std-all

## Cards

- Generate new card bodies with fizzyx flow template.
- Prefer fizzyx flow template --draft for temporary card drafts; it creates .fizzyx/card-<random>.md with a unique suffix.
- Delete the matching temporary draft after fizzyx flow add succeeds.
- Description is context only. Card titles and fields are standardized in English.
- Put work checklist under ## Steps; flow add converts it to card steps.
- Step labels must be plain text: no Markdown links, code ticks, or bold.
- Normalize existing cards with fizzyx flow std <card>.

## Delivery

- Do not create cards for typo fixes or tiny chore commits.
- Do not maintain a parallel progress document; board is execution state.
- **Always close cards through the CLI**, never by clicking close in the UI.
- Close sequence:
   1. fizzyx flow complete-steps <card>  — mark all pending steps done
   2. fizzyx flow done <card>             — close into Done and comment (ref auto-detected from git)
   3. fizzyx flow done <card> "message"   — with explicit ref (optional)
- flow done requires all steps to be complete; it will fail with an error if any step is unfinished.
 - Keep comments concise; use fizzyx flow comment-template <kind> for format.

## OpenAPI Client

Generate a typed wx.request client from OpenAPI spec:

\`\`\`
fizzyx openapi g -i <url|path> -c wx
\`\`\`

When no --output is given, defaults to ./src/api (creates 4 files:
wx-request.ts, types.ts, api.ts, index.ts). Configure --api-name,
--types-name, --runtime-name for custom filenames, or set in .fizzy.yaml:

\`\`\`yaml
openapi:
  - input: ./openapi.json
    output: ./src/api
    client: wx
    run: check
\`\`\`


For full details: fizzyx openapi generate -h`;

const getBuiltinTemplate = (): string => {
	const labels = getTemplateLabels();
	const text = getTemplateText();

	return `## ${labels.goal}
${text.goal}

## ${labels.scope}
### ${labels.include}
- ${text.include}

### ${labels.exclude}
- ${text.exclude}

## ${labels.notes}
- ${text.noteSmall}
- ${text.notePattern}

## ${labels.files}
- ${text.files}

## ${labels.verification}
- ${text.verification}

## Steps

- [ ] ${text.stepGoal}
- [ ] ${text.stepImplementation}
- [ ] ${text.stepPlain}
- [ ] ${text.stepClose}`;
};

const getTemplateText = () => {
	return {
		goal: "Define the ticket objective in 1-2 concise sentences.",
		include: "What should be included",
		exclude: "What should not be included",
		noteSmall: "Keep changes small and deterministic",
		notePattern: "Prefer existing patterns",
		files: "Files to touch (relative path)",
		verification: "Validation and acceptance checks to run before handoff",
		stepGoal: "Replace goal + scope text with final content",
		stepImplementation: "Add or update implementation files",
		stepPlain: "Keep step descriptions in plain text",
		stepClose: "Confirm checks and run fizzyx flow done <number> to close",
	};
};

const getTemplateLabels = () => {
	return {
		scope: "Scope",
		goal: "Goal",
		include: "In",
		exclude: "Out",
		files: "Files",
		verification: "Verification",
		notes: "Notes",
	};
};
