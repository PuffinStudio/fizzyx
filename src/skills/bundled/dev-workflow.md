---
name: dev-workflow
description: Apply branch-first, guard-railed delivery with fizzyx dev commands.
---

# Dev Workflow

Use this when making code changes. Prefer safe sequencing and explicit handoff.

## What to do

1. Run `fizzyx dev status --agent` before editing.
2. Classify work type: feature, fix, hotfix, ops, chore, docs, or tiny follow-up.
3. Use a new branch only when the current branch is unsuitable for the classification.
4. Start branch work with `fizzyx dev start <slug> --kind <kind> [--card <id>]`.
5. Keep long-running work safe with `fizzyx dev checkpoint`.
6. Sync with base using `fizzyx dev sync` (never raw `git merge main`).
7. Re-run `fizzyx dev status --agent` after branch or sync changes.
8. Before reporting completion, run `fizzyx dev ready --agent`.
9. For movement between environments or release, use `fizzyx dev promote --dry-run` first.
10. When blocked by config/guardrail checks, report the blocker and next safe step.

## Must not do

- Edit protected branches directly.
- Create follow-up branches when already on the right non-protected branch.
- Promote environment branches directly into production.
- Skip `fizzyx dev ready` before marking work complete.
- Run `git merge main`, `git reset --hard`, or raw `git push --force` in agent-driven flow.

## When reporting

When a dev workflow step finishes, report:

- Current branch and role
- Target environment/production branch
- Checks run and outcomes
- Promotion action taken or recommended
- Whether cleanup (`fizzyx dev cleanup`) is still pending

## Companion skills

- `diagnose` for bug analysis.
- `tdd` for build/test-first implementation.
- `security-review` for auth, secrets, payment, and input-handling risk.
- `handoff` before pausing or handing work to another agent.
