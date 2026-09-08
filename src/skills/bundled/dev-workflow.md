---
name: dev-workflow
description: Apply branch-first, guard-railed delivery with fizzyx dev commands.
---

# Dev Workflow

Use this when making code changes. Prefer safe sequencing and explicit handoff.

`fizzyx init` maintains a compact, marker-delimited version of this workflow in the project
`AGENTS.md`. It preserves all instructions outside that section. Skill materialization remains
separate and explicit through `fizzyx skill init --project` or `--global`.

## Works with or without a `.fizzyx.yaml`

The git half of this workflow — `fizzyx dev status`, `start`, `sync`, `checkpoint`, `ready`,
`promote`, `cleanup`, `doctor`, `baseline` — works in **any** git repository, configured or
not. Without a config the CLI simply does not touch Fizzy cards; every default (production
branch `main`, protected branches `main`/`master`/`production`/`stable`, branch prefixes named
after the kind) applies as if it had been written out.

The card half — every `fizzyx flow` command, and the `--card` association on `dev start` —
needs a `.fizzyx.yaml` with an API URL and account. In a repository without one, **skip the
steps marked (card only)** below and report that the project is not card-backed. Do not stop
the git workflow, and do not create a config just to make a step work unless the user asks.

## Card workflow (card only)

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

Use `fizzyx flow list` for structured filters on the project board and `fizzyx flow search` for
full-text search. Add single-line notes with `fizzyx flow comment <card> <body>`. Send multiline
Markdown with `fizzyx flow comment <card> --body-file -` and a quoted heredoc.

## Structured output (always use it as an agent)

Every `fizzyx flow` command accepts `--json` and every `fizzyx dev` command accepts `--agent`.
Always pass the machine-readable flag: parse the result instead of scraping human text, and
follow the returned `next_action`/`breadcrumbs` rather than guessing the next command. `--json`
emits a stable `{ ok, data, summary, breadcrumbs }` envelope on stdout; spinner/progress text
goes to stderr, so stdout stays pure. `--agent` output is `key: value` lines.

## Custom Fizzy columns

BACKLOG, READY, IN PROGRESS, and REVIEW are the bundled Fizzyx preset, not mandatory Fizzy
column names. Use `fizzyx flow columns` to discover real IDs and
`fizzyx flow move <card> <column-id-or-name>` as the generic transition on
custom boards. `flow start` targets the configured `in_progress` ID. Use `flow review` only
when the board uses the preset REVIEW column; otherwise use `flow move`. Normal flow commands
must not create, rename, or repair board columns; preset provisioning is an explicit init action.
`flow move` also accepts `maybe`/`triage` and `not-now` for Fizzy system states. Never use a
generic move to bypass the guarded `flow done` completion checks.

## What to do

1. (card only) If working from a card, run `fizzyx flow show <card>` and keep the card number
   attached to branch work with `fizzyx dev start <slug> --kind <kind> --card <card>`.
2. Run `fizzyx dev status --agent` before editing.
   If pre-existing changes must remain, inspect them and explicitly record them with
   `fizzyx dev baseline accept` before task edits.
3. Classify work type: feature, fix, hotfix, ops, chore, docs, or tiny follow-up.
4. Use a new branch only when the current branch is unsuitable for the classification.
5. Start branch work with `fizzyx dev start <slug> --kind <kind> [--card <id>] [--worktree]`.
   Add `--worktree` for parallel or long-running work (see Worktrees below); then `cd` into
   the reported path before any further `fizzyx dev` command. Prefer `--agent` on
   `fizzyx dev start` when scripting: it prints `worktree_path` and `next_action` as
   machine-readable fields.
6. Commit or checkpoint only changes made during the current task. Do not include files that
   were already dirty before you started unless the user explicitly asks.
7. Keep long-running work safe with `fizzyx dev checkpoint`. It stages only the files this
   task touched, untracked ones included, and leaves recorded baseline files alone. `--all`
   is the explicit escape that also commits pre-existing changes you did not make — use it
   only when the user asks. `checkpoint` refuses to commit on a protected branch or a
   detached HEAD; move the work onto its own branch rather than passing `--allow-protected`.
8. Sync with base using `fizzyx dev sync` (never raw `git merge main`). It fetches and then
   rebases (or merges) onto `origin/<base>` when that remote-tracking ref exists, so it
   advances against what was just fetched instead of a stale local branch. On a tree with
   uncommitted or baseline-accepted changes, pass `--stash`.
9. Re-run `fizzyx dev status --agent` after branch or sync changes. `behind_base` is the
   distance from the base ref and is what `dev sync` and `dev ready` act on; `behind_upstream`
   is the distance from the branch's own upstream, which `dev sync` does not change — a
   non-zero value there means someone else pushed to your branch, so coordinate instead of
   rewriting it. `behind` is a deprecated alias of `behind_base`.
10. Run `fizzyx dev ready --agent` before reporting the work complete. This gates completion in
    every repository, card-backed or not: it is a check on the branch, not on a card.
11. (card only) Move cards with `fizzyx flow review <card>` only after ready checks pass.
12. (card only) Close cards with `fizzyx flow done <card> <ref>` only after the relevant commit,
    branch, or accepted change is complete according to project policy. `flow done` blocks while
    the card has unfinished steps — finish them or pass `--complete-steps`. Provide `<ref>`
    explicitly when git cannot infer the closing commit/branch.
13. For movement between environments or release, use `fizzyx dev promote --dry-run` first.
14. Use `fizzyx dev cleanup` only as a cleanup preview, then report pending branch deletions.
    `--confirm-delete` switches to the production branch, so it refuses to run while the tree
    has uncommitted changes; commit or stash them first.
15. When blocked by config/guardrail checks, report the blocker and next safe step.
16. (card only) Use `flow unblock` to return a blocked card to the configured default column,
    `flow reopen` for a closed card, and `flow untriage` only when intentionally returning a
    card to Fizzy Maybe.

## Worktrees

By default, `fizzyx dev start` switches branches in place. This is the right choice for
normal single-threaded work: one task at a time, owning the working tree start to finish.

Prefer an isolated worktree — `fizzyx dev start <slug> --kind <kind> --worktree` — when the
work is **parallel or long-running**:

- Multiple cards or agents are in flight at once and must not disturb each other's tree.
- You need another branch to stay checked out (e.g. keep a review or a running dev server
  on the current branch) while you work.
- The work spans multiple sessions and switching branches would repeatedly churn the tree.

`--worktree` creates the branch in a linked git worktree under
`.git/fizzyx/worktrees/<branch>` and reports its path. `cd` into that path to work there;
`fizzyx dev status`, `checkpoint`, `sync`, and `ready` all operate on the worktree you run
them from. Do not mix worktree and in-place work on the same branch. Worktrees are cleaned up
only by `fizzyx dev cleanup --confirm-delete` (which removes a merged branch's worktree before
deleting the branch), and only when the user explicitly requests deletion.

`fizzyx dev doctor` lists all linked worktrees and flags the ones whose branch is already
merged, so you can see leftover worktrees without shelling out to raw `git worktree list`.

## Multi-project workspaces

Some repositories are opened at a parent folder that groups several projects (for example
`api`, `web`, `app`). If the root `AGENTS.md` contains a `fizzyx:workspace` section, treat it
as an index: before editing any member folder, read that member's own `AGENTS.md`, then run
that member's `fizzyx dev` flow from inside the member directory. Apply a cross-cutting change
in each affected member separately — do not assume one project's branch or checks cover another.
Regenerate the index with `fizzyx init --workspace`.

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
- Squash commits that are already published. `fizzyx dev ready --squash` collapses everything
  back to the merge base, so it refuses when any commit in that range is reachable from a
  remote; land those commits as they are instead of rewriting them.

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

- `coding-standards` for repository-aware style, quality, naming, and tool use.
- `diagnose` for bug analysis.
- `tdd` for build/test-first implementation.
- `security-review` for auth, secrets, payment, and input-handling risk.
- `handoff` before pausing or handing work to another agent.
