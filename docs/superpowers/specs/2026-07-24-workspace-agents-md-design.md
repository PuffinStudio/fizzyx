# Workspace AGENTS.md — Design

Date: 2026-07-24
Status: Approved (brainstorming)
Scope: `fizzyx init` CLI + new `workspace-instructions` use-case
Depends on: none (independent of dev-worktree work; built second)

## Goal

Support driving a coordinated set of sibling project folders (e.g. `api`, `web`,
`mp` / 小程序, `app`) from a single AI agent opened at the parent folder. Provide a
way to generate a **root `AGENTS.md`** that indexes chosen member folders, detects
which of them carry a `.fizzyx.yaml`, and points the agent at each member's own
`AGENTS.md`. This reduces cross-project coordination overhead: when a change (e.g. a
new API endpoint) spans projects, the agent already knows the members and how to
work each one.

## Non-goals

- Not a duplicate of the per-project workflow. The heavy dev-workflow rules already
  live in each member's own `AGENTS.md` (written by single-project `fizzyx init`).
  The workspace section is an **index + coordination note**.
- No cross-project orchestration engine, no running commands across folders.
- Single-project `fizzyx init` (no `--workspace`) behavior is unchanged.

## Decisions (from brainstorming)

- **Surface:** one command that adapts. `fizzyx init` → single project (today).
  `fizzyx init --workspace` → workspace mode. No separate command concept.
- **Selection:** interactive multi-select seeded by a scan of immediate subfolders;
  folders that already have a `.fizzyx.yaml` are pre-checked. Non-TTY fallback
  accepts the pre-checked defaults.
- **Root file location:** `AGENTS.md` in the current working directory (the parent).

## F2.1 — `fizzyx init --workspace`

`src/cli/setup-command.ts`
- Add `workspace: Flag.boolean("workspace")`.
- When `--workspace` is set, branch into `handleWorkspaceInit` before the existing
  single-project logic; the existing paths are otherwise untouched.
- `handleWorkspaceInit`:
  1. Scan immediate subdirectories of `process.cwd()` (skip dotfolders,
     `node_modules`, and the like).
  2. For each, detect `.fizzyx.yaml` / legacy config; if present, read `board`
     (and account) via the existing config codec / repository.
  3. Build member candidates `{ name, path, configured, board? }`; pre-check
     `configured` ones.
  4. Interactive multi-select via readline (numbered toggle list matching the
     OpenAPI-prompt style in `openapi-command.ts`), guarded by `process.stdin.isTTY`;
     non-TTY → use pre-checked defaults.
  5. `syncWorkspaceInstructions(cwd, selectedMembers)` and report the action/path.

## F2.2 — new use-case `src/use-cases/workspace-instructions.ts`

Mirror `agent-instructions.ts`:
- `WORKSPACE_INSTRUCTIONS_START = "<!-- fizzyx:workspace:start -->"`, matching `end`.
- `renderWorkspaceSection(members): string`.
- `syncWorkspaceInstructions(rootDir, members): { action, path }` — idempotent
  replace within markers, preserving everything outside (same algorithm as
  `syncAgentInstructions`).
- A pure `scanWorkspaceMembers(rootDir)` helper (or a thin adapter) so detection is
  unit-testable without a TTY.

## F2.3 — section content

```
<!-- fizzyx:workspace:start -->
## FizzyX workspace

This folder groups multiple projects. When a change spans projects, apply it in each
member and run that member's own `fizzyx dev` flow. Read each member's AGENTS.md
before editing it.

- api/  — fizzyx-configured (board 42); read api/AGENTS.md before editing
- web/  — fizzyx-configured (board 17); read web/AGENTS.md before editing
- mp/   — no .fizzyx.yaml; treat as a plain folder
<!-- fizzyx:workspace:end -->
```

- Configured members show board id (when available) and a pointer to their AGENTS.md.
- Unconfigured members are still listed but flagged, so the agent knows the folder is
  in scope but has no fizzyx workflow.

## F2.4 — tests

`tests/workspace-init.test.ts` (or extend an existing setup test)
- `scanWorkspaceMembers` detects configured vs. unconfigured subfolders and reads
  board ids.
- `syncWorkspaceInstructions` creates a root `AGENTS.md` listing selected members,
  marks configured vs. not, and updates idempotently within markers (second run =
  `unchanged`), preserving out-of-marker content.
- CLI `init --workspace` in non-TTY mode falls back to pre-checked defaults and writes
  the expected section.

## Risks / edge cases

- A member may itself contain nested repos; scan only one level deep.
- Parent folder may already have an `AGENTS.md` with a single-project dev-workflow
  section — the workspace section uses distinct markers, so both can coexist.
- Board read failures must degrade gracefully (list the member as configured without a
  board id rather than aborting).
