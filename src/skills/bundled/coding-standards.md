---
name: coding-standards
description: Apply repository-aware code style, code quality, naming, and tool-use standards while implementing or reviewing changes. Use when writing, editing, refactoring, or reviewing production code, especially when the repository has local conventions, formatters, linters, type checks, or test commands that must be followed.
---

# Coding Standards

Use this skill during implementation and review. Repository rules and surrounding code are the
source of truth; these instructions fill gaps without replacing local conventions.

## 1. Discover the local standard

Before editing:

1. Read applicable `AGENTS.md`, contribution guides, coding standards, and package scripts.
2. Inspect neighboring code and tests for established module, error, naming, and API patterns.
3. Identify the formatter, linter, type checker, test runner, and generated-code boundaries.
4. Prefer repository helpers and existing dependencies over a new abstraction or package.

When rules conflict, follow the narrowest repository instruction that applies to the file. Do not
reformat unrelated code or turn a focused change into a style migration.

## 2. Apply the TypeScript and React profile when detected

Use this profile only when the repository contains the corresponding toolchain. Project-local
rules still take precedence.

### TypeScript

- Preserve the repository's strictness. Do not weaken `tsconfig.json` to make a change compile.
- Prefer inference for local values and explicit types at public, serialized, or dependency
  boundaries.
- Treat external input as `unknown` and validate it at runtime before narrowing.
- Avoid `any`, unchecked assertions, `@ts-ignore`, and non-null assertions unless the surrounding
  code documents a constraint the type system cannot express.
- Model state variants with unions or other existing domain types instead of loosely related
  optional fields.
- Keep browser-only, server-only, and shared modules separated according to the framework's
  established boundaries.

### React

- Keep render logic pure and keep state as small and derived as possible.
- Use Effects to synchronize with external systems, not to derive values that can be calculated
  during render or handled by an event.
- Preserve component ownership patterns. Do not introduce global state when local state or
  composition is sufficient.
- Use stable semantic keys, controlled/uncontrolled conventions consistently, and cleanup for
  subscriptions, timers, and requests.
- Preserve keyboard behavior, focus handling, labels, and semantic HTML when changing UI.
- Add memoization only for measured cost or required referential stability; do not apply it by
  default.

### Bun, pnpm, and OXC

- Detect the package manager from the lockfile and `packageManager` field. Do not create a second
  lockfile or mix Bun and pnpm commands in one repository.
- Run package scripts when they exist instead of bypassing them with globally installed tools.
- Respect workspace filters and run commands from the workspace root or package directory expected
  by the repository.
- Treat OXC configuration and existing `oxlint` suppressions as project policy. Fix violations
  instead of adding blanket disables.
- Run `oxfmt` through the project script or repository configuration. Do not manually reproduce
  formatting rules or reformat unrelated files.
- Do not edit generated dependency metadata by hand; use the selected package manager.

For API payloads, environment variables, persisted data, and browser/server messages, TypeScript
types are not runtime validation. Use the project's established schema or decoder at the boundary.

## 3. Write clear code

- Keep control flow direct. Use early returns when they reduce nesting and preserve readability.
- Make state transitions and side effects explicit. Separate validation, domain decisions, and I/O
  when that separation improves testability.
- Use the type system to represent meaningful constraints; validate untrusted data at boundaries.
- Handle errors at the layer that can add context or recover. Do not silently swallow failures.
- Comment decisions, invariants, and non-obvious constraints, not line-by-line mechanics.
- Delete dead code and temporary diagnostics introduced by the task.

Do not extract an abstraction merely to shorten a function. Extract when it gives one concept a
clear home, removes meaningful duplication, or matches an established extension point.

## 4. Choose truthful names

- Reuse the project's domain vocabulary. Do not introduce synonyms for an existing concept.
- Name functions for observable behavior and values for what they contain, not how they are stored.
- Use verbs for commands and actions; use nouns for values, entities, and types.
- Phrase booleans as predicates such as `isReady`, `hasAccess`, or `shouldRetry`.
- Include units or representation when ambiguity matters, such as `timeoutMs` or `createdAtIso`.
- Avoid vague names such as `data`, `item`, `manager`, `helper`, `utils`, or `handle` when a more
  specific domain name is available.
- Keep public names stable unless the task includes the compatibility and migration work required
  to rename them safely.

If a function cannot be named precisely, reconsider whether it has too many responsibilities.

## 5. Protect quality

- Preserve behavior outside the requested scope and call out intentional compatibility changes.
- Cover changed behavior at the cheapest reliable boundary. Add broader tests as blast radius grows.
- Test failure paths, boundary values, state transitions, and platform differences relevant to the
  change; do not assert only the happy path.
- Avoid hidden global state, time dependence, nondeterministic ordering, and environment assumptions.
- Keep resource ownership clear: close files, processes, sessions, locks, and temporary resources.
- Review concurrency, retries, idempotency, and partial failure when the change crosses I/O boundaries.
- Check security-sensitive input, secrets, authorization, and output escaping with `security-review`.

## 6. Use tools deliberately

- Search with the repository's preferred fast search tool and read enough context before editing.
- Use structured parsers or APIs for structured data instead of ad hoc text replacement.
- Use the repository's normal editing and generation workflow; do not hand-edit generated output
  unless its source is updated too.
- Prefer commands that are portable across supported platforms. Use path APIs and the configured
  shell instead of assuming Unix-only paths or syntax in production code.
- Never run destructive Git or filesystem commands without explicit authorization.
- Run focused checks while iterating, then the repository's complete required check before handoff.
- Inspect the final diff for accidental files, unrelated formatting, debug output, and missing docs.

## Completion checklist

- Local instructions and nearby patterns were followed.
- Names use consistent domain vocabulary and expose intent.
- Errors, inputs, side effects, and platform assumptions are handled explicitly.
- Tests cover the behavior and relevant failure paths.
- Formatter, linter, type checker, and required tests pass.
- The final diff contains only task-related source, tests, generated artifacts, and documentation.
