---
name: dev-workflow
description: Card-driven delivery with fizzyx — one card per requirement, sub-tasks in worktrees, finished on the base branch.
---

# Dev Workflow

Work is done per card. A card is one requirement; its sub-tasks are the card's steps. One
coordinating agent owns the cards and the base branch; sub-agents own one worktree each.
`fizzyx flow` needs a `.fizzyx.yaml`; `fizzyx dev` works in any git repository.

## Output

`flow` commands print compact text: use it. Add `--json` only to parse a field; it returns
one line with lean cards, and `--full` only when you need descriptions or tags. `dev`
commands take `--agent` for `key: value` lines.

## Coordinator

1. `fizzyx flow work --agent` — your in-progress cards with their next unchecked step, and
   the next card. `fizzyx flow show <card>` for the description, steps and comments.
2. New requirement: `fizzyx flow create "<title>" --desc -` with the description on stdin.
   It must contain a `## Steps` task list (`- [ ] …`); `## Tags` is optional.
   `fizzyx flow create --draft` writes the project's template if you want the full shape.
3. `fizzyx flow start <card>` when work begins (it assigns the card to you).
4. Hand each step to a sub-agent, or do it yourself in a worktree (below).
5. Integrate the reported commits onto the base branch, run the project's checks, verify.
6. `fizzyx flow show <card> --check <n>` ticks step n.
7. `fizzyx flow done <card>` closes the card once every step is ticked. An optional second
   argument is a free-text closing note. `--complete-steps` ticks what is left first.

Other moves: `flow comment <card> "<note>"` (or `--body-file -`), `flow block <card>
"<reason>"` / `flow unblock`, `flow move <card> <column>` on boards with custom columns
(`flow columns` lists them), `flow edit <card> --desc <file>` to replace a description
(a card that has steps must keep its `## Steps` list).

## Sub-agent

1. `fizzyx dev start <slug> --kind <fix|feature|chore|docs> --worktree --agent`, then `cd` to
   the printed `worktree_path`. It works from a dirty main checkout and never touches it.
2. Commit your own changes there. Do not touch cards, the base branch, a running server or
   another worktree.
3. Report the commit hashes and what you verified.

## Housekeeping

- `fizzyx dev doctor --agent` — counts, plus the branches whose commits are on no remote and
  not on the base (`local_only`). `--verbose` lists every section.
- `fizzyx dev cleanup` previews the integrated branches it would delete and why. Run it with
  `--confirm-delete` only when the user asks.
- `fizzyx dev ready --agent` checks the branch state and runs `dev.checks.ready`; when it
  prints `checks: none configured` it has verified nothing — run the project's checks.

## Never

- Switch branches in the main checkout, or edit a protected branch directly.
- Push, delete a remote branch, force-push or `git reset --hard` unless the user asks.
- Commit files that were already modified before your task started.
