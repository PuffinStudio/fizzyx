# Fizzyx 1.0.0 Plan

Fizzyx 1.0.0 is a breaking redesign around a small AI-agent development workflow CLI.

## Goals

- Make `flow` the daily development loop.
- Make `skill` the only place that manages AI engineering skills.
- Keep `planner` focused on visualization and snapshots.
- Use one project config, `.fizzyx.yaml`; do not add `skills.lock.json`.
- Bundle default skills in the release and let projects pin the bundled skills they use.
- Treat pinned skills as project preferences; bundled skills are available without install.
- Standardize card metadata tags and move mutable execution state out of tags.

## Command Surface

### Top Level

```sh
fizzyx init
fizzyx flow <command>
fizzyx skill <command>
fizzyx planner <command>
```

### Flow

```sh
fizzyx flow work
fizzyx flow create
fizzyx flow edit <card>
fizzyx flow show <card>
fizzyx flow start <card>
fizzyx flow review <card>
fizzyx flow done <card>
fizzyx flow block <card> <reason>
fizzyx flow improve
fizzyx flow doctor
fizzyx flow repair
```

`flow` owns the development lifecycle. It may recommend skills, but it must not install, update, or remove skills.

### Skill

```sh
fizzyx skill list
fizzyx skill add <source>
fizzyx skill remove <name>
fizzyx skill update [name]
fizzyx skill info <name>
fizzyx skill run <name>
fizzyx skill doctor
fizzyx skill migrate
```

Bundled skills are always available. Adding a skill records a project pin.

### Planner

```sh
fizzyx planner start
fizzyx planner snapshot
```

`planner` is for visualization and debug snapshots. Health and repair move to `flow`.

## Commands To Remove Or Merge

- `flow add` -> `flow create`
- `flow mine` -> `flow work`
- `flow status` -> `flow work` / `flow doctor`
- `flow health` -> `flow work` / `flow doctor`
- `flow ready` -> remove unless scheduling via CLI becomes a clear requirement
- `flow complete-steps` -> `flow done --complete-steps`
- `flow repair-markdown` -> `flow repair`
- `flow repair-metadata` -> `flow repair`
- `flow standardize` -> `flow repair`
- `flow standardize-all` -> `flow repair --all`
- `flow steps-from-desc` -> `flow repair --kind steps`
- `flow workflow` -> skill-managed workflow asset
- `flow template` -> `flow create --draft` or skill-managed template asset
- `flow skill` -> top-level `skill`
- `planner health` -> `flow work` / `flow doctor`
- `planner repair-metadata` -> `flow repair`
- `planner snapshot --auto-fix` -> remove; use `flow repair` first

## Standard Tags

Only these tags are standard in 1.0.0:

```txt
priority:p0|p1|p2
type:feature|bug|chore|blocker
area:<name>
phase:<name>
depends_on:<card>
blocks:<card>
```

Removed from standard tags:

```txt
api_status:*
skill:*
```

### Tag Rules

- `priority` and `type` are global fixed enums.
- `area` is project-defined.
- `phase` is project-defined.
- AI agents must not casually invent `area` or `phase` values.
- Before adding or changing `area` / `phase`, agents should inspect `.fizzyx.yaml`, local workflow docs, `AGENTS.md`, `CONTEXT.md`, and project docs.
- If no project vocabulary exists, omit `area` / `phase` or ask the user to confirm proposed values.

Optional project vocabulary:

```yaml
flow:
  tags:
    areas:
      - flow
      - planner
      - auth
    phases:
      - discovery
      - mvp
      - integration
      - polish
```

## Mutable State Is Not Tag Metadata

Do not add new status tags for every missing input or workflow condition.

Avoid:

```txt
api_status:*
design_status:*
copy_status:*
review_status:*
```

Use one of these instead:

### Steps

```md
## Steps

- [ ] Get final design
- [ ] Confirm API contract
- [ ] Implement
```

### Inputs Needed

```md
## Inputs Needed

- Final Figma design
- API response shape
```

### Blocked Flow State

```sh
fizzyx flow block 123 "waiting for final design"
```

### Blocker Card

```txt
type:blocker
blocks:123
area:design
```

## Skills

### Principles

- Skills are managed only by `fizzyx skill`.
- `flow` consumes and recommends skills, but does not manage them.
- Bundled skills are always available.
- Adding a skill records a project pin.
- Do not create `skills.lock.json`.
- Project skill config lives in `.fizzyx.yaml`.
- Cache directories may be deleted and rebuilt; config remains in YAML.
- Skills do not need to be Fizzy tags.

### Built-In Core Skills

Default built-ins for 1.0.0:

```txt
tdd
diagnose
codebase-design
improve-codebase
to-prd
to-issues
triage
handoff
security-review
```

### Skill Sources

Built-in:

```sh
fizzyx skill add tdd
fizzyx skill add improve-codebase
```

Bundled Matt Pocock aliases:

```sh
fizzyx skill add mattpocock/tdd
fizzyx skill add mattpocock/improve-codebase-architecture
```

### Project Config

```yaml
skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.1.0
    improve-codebase:
      source: builtin
      version: 1.1.0
  defaults:
    feature:
      - tdd
      - codebase-design
    bug:
      - diagnose
      - tdd
    blocker:
      - diagnose
    architecture:
      - improve-codebase
      - codebase-design
  areas:
    auth:
      - security-review
```

## Skill Recommendation

`skill` does not go into tags. `flow work` infers recommended skills from card tags and config.

Example card facets:

```txt
type:bug area:auth
```

Recommended skills:

```txt
diagnose
tdd
security-review
```

`flow create --skill tdd` may add a `Suggested Skills` section to the draft/body, but must not write `skill:*` tags.

## Card Template

```md
## Tags

- priority:p2
- type:feature
- area:<project-area>
- phase:<project-phase>

## Goal

What outcome this card should deliver.

## Context

Important background.

## Acceptance Criteria

- [ ] User-visible behavior
- [ ] Error/empty/loading state
- [ ] Regression case covered

## Inputs Needed

- Design/API/product inputs, if any

## Constraints

Architecture/security/performance constraints.

## Suggested Skills

- tdd

## Plan

- Implementation approach

## Steps

- [ ] First vertical slice
- [ ] Tests/checks
- [ ] Review and close
```

## Flow Behavior

### `flow work`

Combines:

- current work
- next recommended card
- board status summary
- tag health summary
- suggested skills
- missing inputs
- next command

### `flow create`

- Reads template.
- Supports draft mode.
- Validates standard tags.
- Accepts suggested skills without writing `skill:*` tags.
- Does not write hidden metadata.

### `flow edit`

- Updates the title, standard draft description, or both.
- Uses the same description parsing and validation contract as `flow create`.
- Synchronizes standard tags, metadata tags, and the `## Steps` task list.
- Keeps steps as Fizzy step resources instead of embedding them in the description.
- Leaves `flow repair` responsible for legacy normalization rather than routine edits.

### `flow done`

- Requires steps to be complete by default.
- Supports `--complete-steps`.
- Auto-ref still requires a clean worktree.

### `flow repair`

Unifies legacy repair operations:

- hidden metadata -> standard tags
- markdown -> HTML
- old `api_status` -> `Inputs Needed` or steps suggestion
- old `skill:*` tags -> `Suggested Skills` or skill config suggestion
- steps from description
- card standardization

### `flow doctor`

Checks:

- auth
- board
- columns
- cache
- config
- tag vocabulary
- skill pin health
- required migrations

### `flow improve`

Architecture improvement workflow:

- scans codebase
- reports improvement candidates
- can create cards
- defaults to `improve-codebase` and `codebase-design`

## Planner

Keep only:

```sh
fizzyx planner start
fizzyx planner snapshot
```

Remove:

```txt
planner health
planner repair-metadata
snapshot --auto-fix
```

## Migrate

```sh
fizzyx skill migrate --check
fizzyx skill migrate --apply
```

Responsibilities:

- upgrade `.fizzyx.yaml`
- add or upgrade `skills:` config
- refresh local copies of bundled skills
- update `.agents/skills/fizzyx/*`
- migrate old command docs
- migrate hidden metadata
- report old `api_status` tags
- report old `skill:*` tags
- scan historical tags and suggest `areas` / `phases`
- never auto-rename `area` / `phase` without explicit confirmation

## Implementation Slices

### Slice 1: Config Model

- Add `skills` config types.
- Add `flow.tags.areas/phases` config.
- Support project/global config loading.
- Test config parse/render.

### Slice 2: Skill Command

- Add `src/cli/skill.command.ts`.
- Implement `skill list/add/remove/info/update/run/doctor/migrate`.
- Add bundled skill registry.
- Use independent Markdown source files imported as text.
- Pin bundled skills in config YAML and refresh local copies on demand.

### Slice 3: Flow Command Cleanup

- Rebuild `flow.command.ts` around the 1.0 command surface.
- Implement `flow work`, `flow create`, and `flow repair`.
- Remove old scattered commands.

### Slice 4: Tag Schema

- Implement standard tag parser.
- Remove standard support for `api_status`.
- Do not treat `skill:*` as standard metadata.
- Add tag vocabulary doctor/repair.

### Slice 5: Templates And Built-In Fizzyx Skill

- Update card template.
- Update workflow skill.
- Emphasize project-defined `area` and `phase`.
- Emphasize mutable state is not tag metadata.
- Emphasize skills are not tags.

### Slice 6: Migrate

- Add `skill migrate --check` and `skill migrate --apply`.
- Add workflow asset versioning.
- Add migration report.

### Slice 7: Planner Trim

- Keep only planner start/snapshot.
- Move health/repair responsibility to flow.

### Slice 8: Real Workflow Verification

- Real create/show/start/review/done.
- Bundled skill pinning.
- Bundled Matt Pocock aliases.
- Migrate dry-run/apply.
- Full `bun --bun run check`.

## Acceptance Criteria

- `bun --bun run check` passes.
- Old scattered commands are removed or produce direct new-command guidance.
- `flow work` is the daily entry point.
- `flow repair` covers legacy repair behavior.
- `skill add tdd` pins the bundled skill and `skill run tdd` works.
- `.fizzyx.yaml` is the only project config.
- No `skills.lock.json` exists.
- Bundled skills are available without install.
- `area` and `phase` project-defined rules are in the built-in skill.
- `api_status` and `skill:*` are no longer standard tags.
- Planner repair/health commands are removed.
