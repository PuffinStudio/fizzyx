# Dev Worktree Support — Design

Date: 2026-07-24
Status: Approved (brainstorming)
Scope: `fizzyx dev` CLI + bundled `dev-workflow` skill

## Goal

Let an agent or developer start card/branch work in an isolated **git worktree**
instead of switching branches in place, so parallel or long-running work does not
thrash a single working tree. The default behavior (branch in place) stays exactly
as it is today — worktree support is strictly opt-in and additive.

## Non-goals

- No `.fizzyx.yaml` schema change (the worktree path is derived, not configured).
- No new `dev worktree` subcommand group. One opt-in flag on `dev start` only.
- `dev status`, `dev sync`, `dev ready`, `dev checkpoint`, `dev promote` are not
  restructured; they already operate on the current working directory and therefore
  work unchanged when run from inside a worktree.

## Decisions (from brainstorming)

- **Surface:** opt-in `--worktree` flag on `fizzyx dev start` only.
- **Location:** `<git-common-dir>/fizzyx/worktrees/<safe-branch>`, resolved via
  `git rev-parse --git-common-dir`, so it always lands in the shared `.git` even when
  invoked from a linked worktree. Consistent with existing `.git/fizzyx/` state.
- **Cleanup:** worktree-aware. Preview reports worktree-backed merged branches; with
  `--confirm-delete`, remove the worktree before deleting the branch.
- **When-to-use guidance:** default is branch-in-place; prefer a worktree for any
  parallel or long-running work.

## F1.1 — `dev start --worktree`

`src/cli/dev/start.ts`
- Add `worktree: Flag.boolean("worktree")` with a description
  ("Create work in an isolated git worktree instead of switching in place").
- Thread `worktree` into the `startBranch` options.

`src/use-cases/dev-service.ts` — `startBranch`
- All existing logic is preserved: dirty check, `--allow-dirty`, branch-name
  resolution (`prefix/card-<n>-<slug>`), `--from-current`, `--base`, card metadata,
  and the "already exists / already on compatible branch" paths.
- Branching point is **only** the checkout step:
  - Flag absent → `git checkout -b <branch>` (existing code path, untouched).
  - Flag present → create a linked worktree:
    - Resolve `commonDir = git rev-parse --git-common-dir` (absolute).
    - `worktreePath = <commonDir>/fizzyx/worktrees/<safeName(branch)>`, where
      `safeName` reuses the same sanitization used for dev-state file names.
    - New branch → `git worktree add -b <branch> <worktreePath> <base>`.
    - Existing branch not yet checked out → `git worktree add <worktreePath> <branch>`.
    - Existing branch already checked out in a worktree → return a `ValidationError`
      naming the existing worktree path; do not force.
- `StartBranchResult` gains an optional `worktreePath?: string`.
- Baseline capture in worktree mode must reflect the **new** worktree, not the main
  tree. A fresh worktree created from a clean base is clean, so:
  - Thread an optional `cwd` through `snapshotWorktree` and `writeBaseline`
    (default `process.cwd()`), and call `writeBaseline(branch, { cwd: worktreePath })`.
  - Branch metadata (`writeBranchMetadata`) is keyed by branch name and needs no cwd.

`src/cli/dev/start.ts` output
- When `worktreePath` is set, print the created path and the next step, e.g.
  `Created worktree for 'feature/foo' at <path>` and `Next: cd <path>`.

## F1.2 — worktree-aware `dev cleanup`

`src/use-cases/dev-service.ts` — `cleanup` + helper
- Add `listWorktrees()` parsing `git worktree list --porcelain` into
  `{ path, branch }[]` (branch from `branch refs/heads/<name>`).
- Preview: for each merged branch that has a worktree, append `(worktree: <path>)`.
- `--confirm-delete`: for a merged branch with a worktree (never the current one):
  - `git worktree remove <path>`; if it fails (e.g. dirty/locked), skip that branch,
    leave the branch undeleted, and report it. Otherwise proceed to `git branch -d`.
  - After the loop, run `git worktree prune`.
- The current worktree / current branch is never removed (existing guard remains).

## F1.3 — configuration

No change. Path derivation makes config unnecessary; `config-codec.ts`,
`models.ts`, and `.fizzyx.yaml` are untouched.

## F1.4 — skill + AGENTS.md guidance

`src/skills/bundled/dev-workflow.md`
- Add a `## Worktrees` subsection:
  - Default: branch in place with `fizzyx dev start <slug>`.
  - Use `fizzyx dev start <slug> --worktree` when work is **parallel or long-running**:
    concurrent cards/agents, needing another branch checked out at the same time, or
    multi-session work where switching would disturb the current tree.
  - After creating, `cd` into the reported worktree path to work there.
  - `fizzyx dev cleanup` removes merged worktrees only with explicit `--confirm-delete`.

`src/use-cases/agent-instructions.ts`
- Add one bullet to the marker section noting `--worktree` for parallel/long-running
  work, so `fizzyx init` propagates it into project `AGENTS.md`.

## F1.5 — tests

`tests/dev-command.test.ts` (spawns the real CLI against temp repos)
- `dev start <slug> --worktree` creates a worktree under
  `.git/fizzyx/worktrees/`, the branch exists, the worktree HEAD is clean, and the
  path is reported.
- Plain `dev start <slug>` output and behavior are unchanged (regression guard).
- Starting `--worktree` on a branch already checked out elsewhere fails with a clear
  message and does not force.
- `dev cleanup` preview annotates a worktree-backed merged branch.
- `dev cleanup --confirm-delete` removes a merged worktree and then deletes the branch;
  `git worktree list` no longer shows it.

## Risks / edge cases

- `--git-common-dir` may be relative in some git versions; resolve against `cwd`.
- Removing a worktree whose directory is the process cwd would fail; cleanup only
  removes **merged, non-current** branches, so this is avoided.
- Windows path separators: reuse existing path helpers; tests already gate Windows
  shell semantics separately.
