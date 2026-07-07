# AI Agent Git Workflow

This document defines the target Git workflow for fizzyx-assisted daily development,
maintenance, and AI-agent work. It is a product design document, not an implementation
plan.

The goal is to make common Git work safer and more repeatable without turning fizzyx
into a full Git Town, Graphite, or patch-stack replacement. fizzyx should wrap the
parts of Git that AI agents and busy maintainers get wrong most often: branch choice,
sync direction, commit quality, environment promotion, verification, and cleanup.

## References

- Git Town: reusable Git workflow commands for branch creation, sync, review, and ship.
  <https://www.git-town.com/>
- Git Town `sync`: frequent safe branch synchronization and stale branch cleanup.
  <https://www.git-town.com/commands/sync.html>
- Graphite CLI: branch create/sync/submit and stacked-change ergonomics.
  <https://graphite.com/docs/intro-to-cli>
- Graphite cheatsheet: sync, submit, cleanup, navigation, and restack concepts.
  <https://graphite.com/docs/cheatsheet>
- git-branchless: smartlog, undo, restack, and observable commit graph workflows.
  <https://github.com/arxanas/git-branchless>
- GitHub Flow: short-lived branch, review, checks, merge into default branch.
  <https://docs.github.com/get-started/quickstart/github-flow>
- GitLab Flow: feature branches plus environment and production branches.
  <https://about.gitlab.com/topics/version-control/what-is-gitlab-flow/>

## Non-Goals

The first version should not implement:

- Git worktrees.
- Stacked branches as a first-class model.
- Automatic production landing.
- Automatic GitHub/GitLab PR creation.
- CI merge queues.
- A replacement for Git Town, Graphite, jj, or git-branchless.

Those tools solve broader Git graph problems. fizzyx should solve the daily workflow
problem for projects that use Git, local branches, environment branches, and AI agents.

## Core Principle

Features must be independently promotable.

Do not treat `dev`, `test`, `uat`, or `staging` as a single conveyor belt where every
feature on an earlier branch must eventually flow together into production. That leaks
unfinished work. In real projects, feature A may need to go live today, feature C may
remain in staging, and feature B may need an urgent hotfix tonight.

Therefore:

- Feature branches are the source of truth for individual changes.
- Environment branches are deployment targets or integration previews.
- Production updates promote selected feature branches, not the entire integration branch.
- `dev` may aggregate work for local or team testing, but it must not be the only path to
  `main`.

## Agent Safety Model

The workflow must assume AI agents are fast, literal, and sometimes over-eager. Safety
comes from explicit command gates, not from trusting an agent to remember project policy.

fizzyx should make every Git action answer four questions before it runs:

1. What branch am I on?
2. What role does this branch have?
3. What change unit am I operating on?
4. What target branch or environment will receive this change?

If any answer is ambiguous, fizzyx should stop and ask for a human decision.

### Hard Stops

An agent must stop before making changes when:

- Current branch is protected.
- Current branch role is unknown and cannot be inferred from config.
- Current worktree has unrelated dirty files.
- The task asks to release from `dev`, `test`, `uat`, or `staging` into production.
- Promotion source is an environment branch instead of a feature, fix, hotfix, ops, chore,
  or docs branch.
- Promotion source contains WIP commits.
- Promotion source contains commits not related to the selected feature or maintenance
  task.
- Target branch is production and the command lacks explicit production confirmation.

### Required Agent Preflight

Before code edits:

```sh
fizzyx dev status --agent
```

Before test or environment promotion:

```sh
fizzyx dev ready --agent
fizzyx dev promote <branch> --to <environment> --dry-run --agent
```

Before production promotion:

```sh
fizzyx dev ready --full --agent
fizzyx dev promote <branch> --to main --dry-run --agent
```

The `--agent` output should be machine-readable enough for an agent to quote in its final
answer. It should include branch role, base branch, target branch, changed files, commit
list, check results, and blocked reasons.

## Branch Roles

### Protected Branches

Protected branches represent stable or deployed environments.

Common names:

```text
main
master
production
stable
release/*
```

Rules:

- AI agents must not make direct file edits on protected branches.
- Production branches should only receive verified changes through a promotion flow.
- `main` is usually the production branch unless configured otherwise.
- Direct commits to protected branches require an explicit override.

### Environment Branches

Environment branches represent testable deployments.

Common names:

```text
dev
test
uat
staging
preprod
```

Rules:

- Environment branches may be long-lived.
- They may contain multiple features for integration testing.
- They are not automatically safe to merge into production.
- A feature that passed on `staging` should still be promoted from its own feature branch,
  not by merging the whole `staging` branch into `main`.
- Environment branches can be reset or rebuilt from a selected set of feature branches if
  a project wants clean deployment branches.

### Feature and Maintenance Branches

Feature and maintenance branches represent independently promotable units of work.

Recommended naming:

```text
feature/<slug>
fix/<slug>
hotfix/<slug>
ops/<slug>
chore/<slug>
feature/card-123-<slug>
fix/card-123-<slug>
```

Rules:

- One user-visible change, maintenance task, or operational change per branch.
- Branch from the configured release base, usually `origin/main`.
- If a feature must ship independently, do not branch from an integration branch that
  already includes unrelated features.
- Branches should stay short-lived.
- A branch may be tested in multiple environments without losing its identity.

### Local Development Branch

Projects may configure a local default development branch such as `dev`.

This branch is useful for:

- Local integration work.
- Shared testing snapshots.
- Development environments that auto-deploy from `dev`.
- Low-risk exploratory work before extracting a feature branch.

This branch is not sufficient for release control. If unrelated features accumulate on
`dev`, production must still promote selected feature branches instead of merging all of
`dev`.

## When to Create a Branch

Not every edit needs a new branch.

Create a branch when:

- The current branch is protected.
- The change is user-visible.
- The change may need independent testing or release.
- The change touches production, deployment, auth, data, migrations, generated clients, or
  dependency versions.
- The work maps to a Fizzy card, GitHub issue, customer request, incident, or maintenance
  ticket.
- More than one logical requirement is active on the same environment branch.

Do not create a new branch when:

- You are already on the correct feature or maintenance branch.
- The change is a small follow-up to the current branch's purpose.
- The edit is documentation-only and the current branch is not protected.
- The user explicitly asks for a tiny local cleanup on the current non-protected branch.

If uncertain, fizzyx should recommend a branch. Branches are cheaper than leaked
production changes.

### Branch Decision Table

| Situation                                                                           | Recommended action                                        |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------- |
| On `main` and changing code                                                         | Create a feature, fix, hotfix, ops, chore, or docs branch |
| On `dev`/`test`/`uat`/`staging` and starting an independently shippable change      | Create a feature or maintenance branch                    |
| On an existing branch for the same task                                             | Continue on the current branch                            |
| Documentation-only edit on a non-protected branch                                   | Continue on the current branch                            |
| Small follow-up to current branch purpose                                           | Continue on the current branch                            |
| Dependency, migration, generated code, deployment, auth, data, or production change | Create a branch                                           |
| Incident or urgent production repair                                                | Create a `hotfix/*` branch from production                |

The default recommendation should be conservative. If the branch choice can affect what
ships to production, use a dedicated branch.

## Commit Standards

The workflow should enforce a clear difference between local checkpoints and final
reviewable commits.

### Checkpoint Commits

Checkpoint commits are allowed during agent work.

Examples:

```text
wip: sketch dev workflow commands
wip(card-123): add planner chat config
```

Rules:

- Checkpoint commits are acceptable on feature branches.
- `dev ready` should warn if final history still contains `wip:` commits.
- `dev ready --squash` may squash checkpoint commits into one reviewable commit.
- Checkpoint commits must not be promoted to production unless explicitly allowed.

### Reviewable Commits

Reviewable commits should follow conventional commit style.

Examples:

```text
feat(dev): add branch workflow status
fix(dev): prevent sync on dirty branches
chore(deps): refresh lockfile
ops(release): update staging deployment config
docs(dev): document promotion workflow
```

Rules:

- Use a type that reflects the change: `feat`, `fix`, `docs`, `test`, `refactor`,
  `chore`, `ops`, or `ci`.
- Include a scope when it improves scanning.
- Include card or issue references in the body or footer when available.
- Do not mix unrelated requirements in one commit.
- `hotfix/*` branches should usually produce `fix(...)` or `ops(...)` commits.

## Environment Promotion

Promotion means applying a selected branch to a selected target branch.

Examples:

```sh
fizzyx dev promote feature/card-101-a --to test
fizzyx dev promote feature/card-101-a --to staging
fizzyx dev promote feature/card-101-a --to main
fizzyx dev promote hotfix/login-timeout --to main
```

Promotion rules:

- Promote the feature branch, not the aggregate environment branch.
- Verify the feature branch against the target base before promotion.
- If the target branch has moved, rebase or replay the feature branch before promotion.
- If the target already contains unrelated features, warn before promoting from it.
- Hotfix branches should start from and target production by default.
- Production promotion must name the source branch and target branch explicitly.
- Production promotion from aggregate environment branches is blocked by default.
- Production promotion requires full verification and explicit confirmation.

Implementation may use merge commits, squash commits, cherry-picks, or PRs depending on
project config. The first implementation should default to safe local guidance and avoid
silent production writes.

Recommended default:

```yaml
dev:
  promotion:
    strategy: pr
    allow_direct_production_merge: false
```

For local-only repositories:

```yaml
dev:
  promotion:
    strategy: merge
    allow_direct_production_merge: true
```

### Promotion Preflight

`fizzyx dev promote <branch> --to <target>` should run these checks before showing or
executing Git commands:

1. Source branch exists locally or remotely.
2. Target branch exists locally or remotely.
3. Source branch role is independently promotable.
4. Target branch role is environment or production.
5. Source branch is not an aggregate environment branch unless an explicit override is
   configured.
6. Source branch has no forbidden WIP commits.
7. Source branch has passed the configured ready checks.
8. Source branch does not contain commits from unrelated feature branches.
9. Target branch has been fetched recently.
10. Production target requires `--confirm-production`.

If any check fails, the command must explain the blocked reason and show a safe next
command.

### Production Release Example

Feature branch after testing:

```sh
fizzyx dev ready --full
fizzyx dev promote feature/payment-coupon --to main --dry-run
fizzyx dev promote feature/payment-coupon --to main --apply --confirm-production
fizzyx dev cleanup feature/payment-coupon
```

This promotes only `feature/payment-coupon`. It must not promote the entire `test`,
`uat`, or `staging` branch.

### Environment Refresh Example

If staging has accumulated unapproved work and needs to test only selected features:

```sh
fizzyx dev promote feature/a --to staging --apply
fizzyx dev promote hotfix/b --to staging --apply
```

If the project allows rebuilding staging from a selected set, a future command may support:

```sh
fizzyx dev rebuild-env staging --from main --include feature/a --include hotfix/b
```

That command is intentionally future scope because it can rewrite long-lived environment
branches.

## Common Scenarios

### Scenario A: Feature A and Feature C Are Both in Testing, Only A Ships

Branches:

```text
main
feature/a
feature/c
staging
```

Flow:

```sh
fizzyx dev promote feature/a --to staging
fizzyx dev promote feature/c --to staging
# customer approves A but not C
fizzyx dev promote feature/a --to main
```

Do not merge `staging` into `main`, because that would leak feature C.

### Scenario B: Urgent Hotfix B While A and C Are Still Testing

Branches:

```text
main
hotfix/b
feature/a
feature/c
staging
```

Flow:

```sh
fizzyx dev start login-timeout --kind hotfix --base main
fizzyx dev ready --full
fizzyx dev promote hotfix/login-timeout --to main
fizzyx dev promote hotfix/login-timeout --to staging
```

Hotfixes go to production first if urgent, then are synchronized back into active
environment branches.

### Emergency Hotfix Flow

Use this when production is broken and unrelated work is active in development or staging.

```sh
fizzyx dev status
fizzyx dev start login-timeout --kind hotfix --base main
# apply the minimal production fix
fizzyx dev checkpoint --message "fix(auth): handle login timeout"
fizzyx dev ready --full
fizzyx dev promote hotfix/login-timeout --to main --dry-run
fizzyx dev promote hotfix/login-timeout --to main --apply --confirm-production
fizzyx dev promote hotfix/login-timeout --to staging --apply
fizzyx dev cleanup hotfix/login-timeout
```

Rules:

- Hotfix branches start from production, not from `dev` or `staging`.
- The branch should contain the smallest viable fix.
- Do not include opportunistic refactors.
- Production promotion happens before backfilling environment branches when the incident is
  urgent.
- After production, promote the hotfix back to active environment branches so the fix is not
  lost in later releases.

If the hotfix depends on an unapproved feature, stop and ask for a human release decision.

### Scenario C: Maintenance Task Without a Card

Flow:

```sh
fizzyx dev start refresh-openapi-client --kind chore
fizzyx dev checkpoint
fizzyx dev ready
fizzyx dev promote chore/refresh-openapi-client --to test
```

No Fizzy card is required. The Git workflow remains useful for maintenance.

### Scenario D: Small Documentation Fix on a Non-Protected Branch

If already on a feature branch:

```sh
# edit docs
fizzyx dev status
fizzyx dev checkpoint --message "docs(dev): clarify sync behavior"
```

No new branch is necessary because the current branch already owns the context.

If on `main`, create a branch.

## Command Model

### `fizzyx dev status`

Shows:

- Current branch and role.
- Base branch.
- Whether the branch is protected, environment, feature, maintenance, or unknown.
- Dirty files.
- Ahead/behind status.
- Associated card or issue.
- Recommended next action.
- Promotion readiness.

For AI agents, this is the first command before making file edits.

### `fizzyx dev start <name>`

Creates or enters a development branch.

Important flags:

```sh
--kind feature|fix|hotfix|ops|chore|docs
--card <number>
--base <branch>
--from-current
```

Rules:

- Refuse to start with a dirty worktree unless `--allow-dirty` is explicitly provided.
- Default base is configured production branch, usually `origin/main`.
- Hotfix default base is production.
- Branch name is derived from `kind`, card, and slug.
- If already on a compatible branch, explain that no new branch is needed.

### `fizzyx dev sync`

Synchronizes the current branch with its base.

Rules:

- Fetch remote.
- Rebase onto the configured base by default.
- Refuse to run with uncommitted changes unless `--stash` is provided.
- Never create `merge main` commits.
- Stop and print recovery instructions on conflict.

### `fizzyx dev checkpoint`

Creates a local checkpoint commit.

Rules:

- Commit only staged changes by default.
- `--all` stages tracked changes.
- Generate a `wip(...)` message if no message is provided.
- Include card id if known.

### `fizzyx dev ready`

Turns an in-progress branch into a reviewable/promotable branch.

Checks:

- Not on a protected branch.
- Branch is synced with base.
- Working tree is clean.
- No forbidden commit messages unless allowed.
- Configured checks pass.
- Changed file list is coherent with branch kind and optional card.

Outputs:

- Summary for humans.
- Machine-readable summary for agents.
- Suggested promotion commands.

### `fizzyx dev promote <branch> --to <target>`

Prepares or performs promotion to an environment or production branch.

First implementation should be conservative:

- Verify source branch exists.
- Verify target branch role.
- Verify source is up to date with target base or explain required sync.
- Show exact Git commands that would run.
- Use `--apply` to perform local promotion.

Production targets should require `--apply --confirm-production` or project config allowing
direct promotion.

### `fizzyx dev rebuild-env <environment>`

Future command for rebuilding an aggregate environment branch from a known base and selected
branches.

Example:

```sh
fizzyx dev rebuild-env staging --from main --include feature/a --include hotfix/b
```

Rules:

- Must be disabled by default in the MVP.
- Must show an exact command preview.
- Must require explicit confirmation because it may rewrite an environment branch.
- Must never target production.

### `fizzyx dev cleanup`

Cleans local development state.

Rules:

- Refuse to delete unmerged branches unless `--abandon` or `--force` is provided.
- Delete local branch only after switching to a safe base branch.
- Prune stale remote-tracking branches.
- Keep a lightweight session summary if configured.
- Do not delete dependencies or project files because this workflow does not use worktrees.

### `fizzyx dev doctor`

Audits workflow hygiene.

Reports:

- Branches older than `stale_after_days`.
- Branches with no upstream.
- Branches merged into main that can be deleted.
- Environment branches ahead of production.
- Feature branches based on environment branches when they should be based on production.
- WIP commits on branches marked ready.
- Protected branch dirty state.

## Configuration

Global config lives in:

```text
~/.config/fizzyx/config.yaml
```

Project config lives in:

```text
.fizzyx.yaml
```

Example:

```yaml
dev:
  production_branch: main
  default_base: main
  sync_strategy: rebase
  protected_branches:
    - main
    - master
    - production
    - stable
  environment_branches:
    dev:
      deploys_to: development
      aggregate: true
    test:
      deploys_to: test
      aggregate: true
    uat:
      deploys_to: uat
      aggregate: true
    staging:
      deploys_to: staging
      aggregate: true
  branch_prefixes:
    feature: feature
    fix: fix
    hotfix: hotfix
    ops: ops
    chore: chore
    docs: docs
  checks:
    ready:
      - bun --bun run check
    hotfix:
      - bun --bun run check
  promotion:
    strategy: pr
    allow_direct_production_merge: false
    block_environment_to_production: true
    require_confirm_production: true
    require_ready_for_production: true
  stale_after_days: 7
  commit:
    conventional: true
    allow_wip_on_ready: false
```

## Fizzy Flow Integration

`fizzyx dev` owns Git workflow. `fizzyx flow` owns Fizzy cards and workflow columns.

They should integrate without depending on each other:

- A project without Fizzy cards can use `fizzyx dev`.
- A Fizzy-backed project can bind a dev branch to a card.
- `flow` may call `dev` for Git-safe task starts and completions.
- `dev` may read card metadata for branch names and summaries when a card is provided.
- Git promotion must not require a card.

### Flow-to-Dev Mapping

| Flow action                     | Dev integration                                                            |
| ------------------------------- | -------------------------------------------------------------------------- |
| `fizzyx flow start <card>`      | May suggest or run `fizzyx dev start <slug> --card <card>`                 |
| `fizzyx flow work`              | Shows current card plus branch state from `fizzyx dev status`              |
| `fizzyx flow review <card>`     | Should require or suggest `fizzyx dev ready` first                         |
| `fizzyx flow done <card> <ref>` | Should verify that the referenced commit or branch passed dev ready checks |
| `fizzyx flow block <card>`      | Can include current dev branch and blocked reason                          |

### Card-Bound Branch Metadata

When `dev start --card 123` runs, fizzyx should store lightweight metadata:

```yaml
dev:
  branches:
    feature/card-123-payment-coupon:
      card: 123
      kind: feature
      base: main
      created_at: "2026-07-07T00:00:00Z"
```

This metadata is for guidance only. The Git branch remains the source of truth for code.

### Flow Rules for Agents

When a card exists:

1. Use `flow show <card>` to understand the task.
2. Use `dev start <slug> --card <card>` before code changes if not already on a suitable
   branch.
3. Use `dev ready` before moving the card to review.
4. Use `dev promote` to test or release the branch.
5. Use `flow done` only after the selected branch or commit is actually merged, promoted, or
   accepted according to project policy.

When no card exists:

1. Use `dev start <slug> --kind <kind>`.
2. Use `dev ready` before reporting completion.
3. Use `dev promote` for environment or production updates.

## Skill Workflow Integration

The command layer and skill layer should have different responsibilities.

- `fizzyx dev` provides executable Git operations and safety checks.
- `fizzyx skill` manages local agent guidance.
- A bundled `dev-workflow` skill should teach AI agents how to choose and sequence `dev`
  commands for daily development, maintenance, testing, release, and hotfix work.

The current skill command surface already supports this shape:

```sh
fizzyx skill list
fizzyx skill add dev-workflow
fizzyx skill info dev-workflow
fizzyx skill run dev-workflow
fizzyx skill update dev-workflow
fizzyx skill doctor
```

### Default Bundled Skill

The default skill should be named:

```text
dev-workflow
```

Suggested aliases:

```text
git-workflow
agent-git
```

This skill should be bundled with fizzyx and safe to pin into projects. It should be the
default Git workflow skill recommended by `flow work`, `flow show`, and `dev status` when
an agent is about to edit code.

### What the Skill Does

The `dev-workflow` skill should guide agents through decisions, not bypass the command
guards.

It should tell agents to:

1. Run `fizzyx dev status --agent`.
2. Classify the task: feature, fix, hotfix, ops, chore, docs, or tiny follow-up.
3. Decide whether a new branch is needed using the branch decision table.
4. Use `fizzyx dev start` only when the current branch is unsuitable.
5. Use `fizzyx dev sync` instead of raw `git merge main`.
6. Use `fizzyx dev checkpoint` for long-running work.
7. Use task-specific skills when appropriate:
   - `diagnose` for bugs.
   - `tdd` for feature or bugfix implementation.
   - `security-review` for auth, secrets, payments, user input, or production-sensitive
     changes.
   - `handoff` before pausing or transferring work.
8. Run `fizzyx dev ready --agent` before reporting completion.
9. Use `fizzyx dev promote --dry-run` for environment or production movement.
10. Report blocked states instead of guessing.

### What the Skill Must Not Do

The skill must not instruct agents to:

- Edit protected branches directly.
- Merge `dev`, `test`, `uat`, or `staging` into production.
- Promote an environment branch into production.
- Skip `dev ready`.
- Use raw `git push --force`.
- Use `git reset --hard` as cleanup.
- Treat a Fizzy card as required for Git work.
- Create new branches for tiny follow-ups on an already suitable feature branch.

### Skill Invocation by Scenario

Feature work:

```sh
fizzyx skill run dev-workflow
fizzyx dev start payment-coupon --kind feature --card 123
```

Bug fix:

```sh
fizzyx skill run diagnose
fizzyx skill run dev-workflow
fizzyx dev start login-error --kind fix
```

Emergency hotfix:

```sh
fizzyx skill run dev-workflow
fizzyx skill run security-review
fizzyx dev start login-timeout --kind hotfix --base main
```

Maintenance:

```sh
fizzyx skill run dev-workflow
fizzyx dev start refresh-openapi-client --kind chore
```

### Flow Defaults

The default project workflow should be:

```yaml
skills:
  defaults:
    feature:
      - dev-workflow
      - tdd
    bug:
      - dev-workflow
      - diagnose
      - tdd
    hotfix:
      - dev-workflow
      - diagnose
      - security-review
    ops:
      - dev-workflow
      - security-review
    chore:
      - dev-workflow
```

Projects can override this in `.fizzyx.yaml`. The default should remain conservative and
match the branch-first workflow in this document.

### Flow and Skill Interaction

`fizzyx flow work` should show suggested skills from the card type and area. When a card is
selected, the suggested first skill for implementation work should usually be
`dev-workflow`.

Example output:

```text
Suggested skills:
  dev-workflow  branch and promotion guardrails
  tdd           behavior-first implementation
  security-review auth-sensitive change

Suggested Git action:
  fizzyx dev start payment-coupon --kind feature --card 123
```

The skill provides the reasoning. `fizzyx dev` enforces the action.

## AI Agent Rules

Agents should follow these rules:

1. Run `fizzyx dev status` before making code edits.
2. Do not edit protected branches directly.
3. Do not create a new branch if already on the correct non-protected branch for the
   current task.
4. Create a feature, fix, hotfix, ops, chore, or docs branch for independently shippable
   work.
5. Do not merge aggregate environment branches into production.
6. Use `fizzyx dev sync`; do not run `git merge main`.
7. Use checkpoint commits for long-running work.
8. Before reporting completion, run `fizzyx dev ready`.
9. Promote selected feature branches to selected environment branches.
10. Run `fizzyx dev cleanup` after merge, promotion, or abandonment.

### AGENTS.md Snippet

Projects can copy this into `AGENTS.md`:

```md
## Git workflow for agents

- Run `fizzyx dev status --agent` before code edits.
- Never edit protected branches directly: main, master, production, stable, release/\*.
- Do not create a new branch when already on the correct non-protected branch.
- Create a feature/fix/hotfix/ops/chore/docs branch for independently shippable work.
- Use `fizzyx dev sync`; do not run `git merge main`.
- Do not merge dev/test/uat/staging into production.
- Promote selected source branches to selected target branches with `fizzyx dev promote`.
- Production promotion requires `--dry-run` first, then explicit human approval or
  `--confirm-production`.
- Use `fizzyx dev ready` before reporting work as complete.
- Use `fizzyx dev cleanup` after merge, promotion, or abandonment.
```

### Agent Output Requirements

When an agent finishes a Git workflow step, it should report:

- Current branch.
- Branch role.
- Target environment or production branch, if any.
- Checks run and results.
- Promotion command used or recommended.
- Whether cleanup is still pending.

This makes mistakes visible to the user before production is changed.

## MVP Scope

The first implementation should include:

- `dev status`
- `dev start`
- `dev sync`
- `dev checkpoint`
- `dev ready`
- `dev cleanup`
- `dev doctor`

Promotion should be designed in the first version but can be implemented in a conservative
mode:

- `dev promote --dry-run`
- exact command preview
- branch-role validation
- production confirmation checks
- environment-to-production leak prevention

Direct promotion with `--apply` can follow once the safety checks are proven.

## Success Criteria

The workflow is successful when:

- A project can use it without Fizzy cards.
- A project with Fizzy cards can bind a branch to a card.
- Agents stop editing `main` directly.
- Agents stop creating `merge main` commits.
- Feature A can be promoted without feature C.
- Hotfix B can ship without leaking staged work.
- Environment branches remain useful for testing without becoming production sources of
  truth.
- Local stale branches are visible and easy to clean.
- Commit messages are readable enough for humans and automation.
