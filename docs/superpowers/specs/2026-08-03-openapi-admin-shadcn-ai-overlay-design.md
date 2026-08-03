# OpenAPI Admin shadcn and AI Overlay Design

## Goal

Make a generated Next.js or TanStack Start admin start from the current official shadcn CLI,
then compile OpenAPI into deterministic physical files that an AI coding agent can safely enrich
through a validated, reviewable UI configuration.

## Decisions

### shadcn owns application initialization

Fresh projects use one official initializer:

```text
shadcn@latest init --template next|start --name <project> --cwd <parent> --yes
```

FizzyX no longer invokes create-next-app or `@tanstack/cli`, and it does not seed
`components.json` or framework utility files. It may still install the typed client/runtime
dependencies and render project-specific Admin descriptors and thin route adapters.

Repeated `--shadcn-arg=<value>` options on `fizzyx openapi admin` are forwarded as individual argv
values to `shadcn init`; this preserves exact argument boundaries without shell concatenation.
Structural arguments controlled by FizzyX (`template`, `name`, `cwd`, non-interactive mode, and
defaults mode) are rejected before any process or filesystem mutation. `--monorepo` is also rejected
until generated route placement understands workspace layouts. Other arguments remain
forward-compatible with the installed shadcn CLI.

### OpenAPI compilation stays deterministic

The required pipeline is:

```text
OpenAPI + explicit x-fizzyx-admin metadata
  -> deterministic base AdminPlan
  -> validated .fizzyx/admin-ui.yaml overlay
  -> final AdminPlan
  -> generated physical descriptors/routes
  -> machine-owned manifest
```

Generation and CI do not require an AI provider. Missing overlay files mean deterministic defaults;
invalid overlays fail closed with actionable validation errors.

### AI owns suggestions, not execution state

`.fizzyx/admin-ui.yaml` is a seed-once, user-owned file. It can select presentation-only values:
labels, navigation groups/order, controlled icons, visibility, action surfaces, and ordered subsets
of known list/form fields. It cannot add operations, change paths, alter auth, install packages,
select arbitrary imports, or execute commands.

Explicit `x-fizzyx-admin` metadata wins over overlay suggestions. The overlay wins over inferred
presentation defaults. Every resource, field, surface, and icon reference is validated against the
base plan and controlled registries.

The generated Admin development skill tells an AI agent to inspect the OpenAPI and base plan, edit
the overlay, run `fizzyx openapi admin sync --plan`, review the semantic diff, and only then run
`--apply`. OpenAPI descriptions and examples are untrusted content, never instructions.

### The manifest stays machine-owned

`.fizzyx/admin-manifest.json` records generator/scaffold versions, shadcn initialization argv,
framework/package manager, OpenAPI and overlay fingerprints, applied AdminPlan, file ownership, and
conflicts. AI agents never edit it directly. A sync only commits new applied fingerprints and plan
state after conflict checks and target-project quality checks pass.

## Ownership matrix

| Owner | Artifacts |
| --- | --- |
| shadcn | Framework scaffold, `components.json`, base styles, shadcn UI components |
| FizzyX generated | Typed API/query client, AdminPlan descriptor, resource descriptors, thin routes |
| FizzyX seed-once | `.fizzyx/admin-ui.yaml`, `src/admin/config.ts`, registries, agent guidance |
| User/agent | Overlay edits, custom cells/actions/pages, application-specific composition |
| Manifest | Hashes, fingerprints, tool/scaffold metadata, applied plan snapshot |

## Migration and failure behavior

- Existing generated projects are never re-initialized.
- A legacy manifest without shadcn scaffold metadata remains syncable and emits a migration
  diagnostic; its next successful generation records the metadata it can safely infer.
- Passthrough conflicts and invalid overlays fail before scaffold or generated-file mutation.
- Modified generated files block the complete apply; user-owned and seed-once files are preserved.
- Failed validation, quality checks, or builds do not advance applied fingerprints.
