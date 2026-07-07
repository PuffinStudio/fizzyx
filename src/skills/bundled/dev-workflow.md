---
name: dev-workflow
description: Apply branch-first, guard-railed delivery with fizzyx dev commands.
---

# Dev Workflow

Use this when making code changes. Prefer safe sequencing and explicit handoff.

## What to do

1. Run `fizzyx dev status --agent` before editing.
   Treat the reported `dirty_files` as the baseline for pre-existing user changes.
2. Classify work type: feature, fix, hotfix, ops, chore, docs, or tiny follow-up.
3. Use a new branch only when the current branch is unsuitable for the classification.
4. Start branch work with `fizzyx dev start <slug> --kind <kind> [--card <id>]`.
5. Commit or checkpoint only changes made during the current task. Do not include files that
   were already dirty before you started unless the user explicitly asks.
6. Keep long-running work safe with `fizzyx dev checkpoint`.
7. Sync with base using `fizzyx dev sync` (never raw `git merge main`).
8. Re-run `fizzyx dev status --agent` after branch or sync changes.
9. Before reporting completion, run `fizzyx dev ready --agent`.
10. For movement between environments or release, use `fizzyx dev promote --dry-run` first.
11. Use `fizzyx dev cleanup` only as a cleanup preview, then report pending branch deletions.
12. When blocked by config/guardrail checks, report the blocker and next safe step.

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

`fizzyx dev status --agent` is the baseline. If files are dirty before you edit, treat them as
user-owned and leave them out of your commits. If files become dirty because of your current
task, they are your responsibility: stage only those paths, create an appropriate commit or
`fizzyx dev checkpoint`, then run `fizzyx dev ready --agent` again.

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
