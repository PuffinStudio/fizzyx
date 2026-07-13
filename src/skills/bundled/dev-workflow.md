---
name: dev-workflow
description: Apply branch-first, guard-railed delivery with fizzyx dev commands.
---

# Dev Workflow

Use this when making code changes. Prefer safe sequencing and explicit handoff.

`fizzyx init` maintains a compact, marker-delimited version of this workflow in the project
`AGENTS.md`. It preserves all instructions outside that section. Skill materialization remains
separate and explicit through `fizzyx skill init --project` or `--global`.

## Card workflow

When creating a Fizzy card, do not pass plain text directly to `flow create`.

1. Generate the standard local template with `fizzyx flow create --draft`.
2. Fill the draft sections, especially `## Goal`, `## Acceptance Criteria`, `## Suggested Skills`,
   `## Plan`, and `## Steps`.
3. Create the card from the filled draft with
   `fizzyx flow create "<title>" --desc <draft-path>`.
4. Keep mutable execution state in Fizzy steps, `## Inputs Needed`, and blocker comments.
5. Never create a card that has no `## Steps` task list.
6. `flow create` does not assign by default. Use `--assign <user>` only when ownership is
   explicit, or run `fizzyx flow assign <card> <user>` after creation.

When editing an existing card, keep the same contract:

1. Edit from a standard draft containing `## Steps`, not from an ad hoc description.
2. Rebuild the current remote state with `fizzyx flow edit <card> --draft` when no local draft exists.
3. Run `fizzyx flow edit <card> --desc <draft-file>` to synchronize the description, tags,
   metadata, and Fizzy steps. Add `--title "<title>"` when the title also changes.
4. Use `fizzyx flow edit <card> --title "<title>"` for a title-only change.
5. Use `flow repair` only to normalize legacy or malformed cards; it is not the normal edit path.

## Custom Fizzy columns

BACKLOG, READY, IN PROGRESS, and REVIEW are the bundled Fizzyx preset, not mandatory Fizzy
column names. Use `fizzyx flow columns` to discover real IDs and
`fizzyx flow move <card> <column-id-or-name>` as the generic transition on
custom boards. `flow start` targets the configured `in_progress` ID. Use `flow review` only
when the board uses the preset REVIEW column; otherwise use `flow move`. Normal flow commands
must not create, rename, or repair board columns; preset provisioning is an explicit init action.

## What to do

1. If working from a card, run `fizzyx flow show <card>` and keep the card number attached
   to branch work with `fizzyx dev start <slug> --kind <kind> --card <card>`.
2. Run `fizzyx dev status --agent` before editing.
   If pre-existing changes must remain, inspect them and explicitly record them with
   `fizzyx dev baseline accept` before task edits.
3. Classify work type: feature, fix, hotfix, ops, chore, docs, or tiny follow-up.
4. Use a new branch only when the current branch is unsuitable for the classification.
5. Start branch work with `fizzyx dev start <slug> --kind <kind> [--card <id>]`.
6. Commit or checkpoint only changes made during the current task. Do not include files that
   were already dirty before you started unless the user explicitly asks.
7. Keep long-running work safe with `fizzyx dev checkpoint`.
8. Sync with base using `fizzyx dev sync` (never raw `git merge main`).
9. Re-run `fizzyx dev status --agent` after branch or sync changes.
10. Before moving a card to review or reporting completion, run `fizzyx dev ready --agent`.
11. Move cards with `fizzyx flow review <card>` only after ready checks pass.
12. Close cards with `fizzyx flow done <card> <ref>` only after the relevant commit, branch,
    or accepted change is complete according to project policy.
13. For movement between environments or release, use `fizzyx dev promote --dry-run` first.
14. Use `fizzyx dev cleanup` only as a cleanup preview, then report pending branch deletions.
15. When blocked by config/guardrail checks, report the blocker and next safe step.

## Must not do

- Edit protected branches directly.
- Create follow-up branches when already on the right non-protected branch.
- Promote environment branches directly into production.
- Skip `fizzyx dev ready` before marking work complete.
- Delete local branches automatically.
- Run `fizzyx dev cleanup --confirm-delete` unless the user explicitly requests branch deletion.
- Delete remote branches, even with user confirmation.
- Run remote branch deletion commands such as `git push origin --delete <branch>` or `git push origin :<branch>`.
- Run `git merge main`, `git reset --hard`, or raw `git push --force` in agent-driven flow.
- Refuse to commit solely because `git status` is dirty when the dirty files are your own
  current-task edits. Stage only your files and commit/checkpoint them.
- Commit pre-existing dirty files from before your task unless the user explicitly asks.

## Dirty Work Ownership

The baseline is stored under `.git/fizzyx/`, never in `.fizzyx.yaml`. Unchanged baseline files
are reported separately and do not block readiness. If the baseline is missing, do not guess
ownership: inspect the worktree and use `fizzyx dev baseline accept` explicitly. Task changes
remain the agent's responsibility and must be committed before `fizzyx dev ready --agent`.

## When reporting

When a dev workflow step finishes, report:

- Current branch and role
- Target environment/production branch
- Checks run and outcomes
- Promotion action taken or recommended
- Whether cleanup preview (`fizzyx dev cleanup`) found branch deletions pending

## Companion skills

- `diagnose` for bug analysis.
- `tdd` for build/test-first implementation.
- `security-review` for auth, secrets, payment, and input-handling risk.
- `handoff` before pausing or handing work to another agent.
