<!-- fizzyx:dev-workflow:start -->

## FizzyX development workflow

- Read this section before card-backed development. If `.agents/skills/dev-workflow/SKILL.md` exists, read it for the complete workflow.
- Use `fizzyx flow` for remote Fizzy card and board state. Use `fizzyx dev` for local Git branches, checks, promotion, and cleanup.
- Start by running `fizzyx flow work` (or `fizzyx flow show <card>`) and `fizzyx dev status --agent`.
- Treat the initial dirty files as user-owned. Run `fizzyx dev baseline accept` only after inspecting them.
- Start local work with `fizzyx dev start <slug> --kind <kind> --card <number>`, then move the remote card with `fizzyx flow start <number>`.
- Board columns are project-defined. Inspect them with `fizzyx flow columns` and use `fizzyx flow move <card> <column-id-or-name>` for custom transitions. `flow review` is only a convenience for boards using the bundled REVIEW preset.
- Before reporting completion, run `fizzyx dev ready --agent`. Use `fizzyx flow done <card> <ref>` only after the required checks and deliverable reference exist.
- Use `fizzyx dev sync`; do not merge protected or aggregate branches by hand. Production promotion requires a dry run and explicit confirmation.
- Run `fizzyx dev cleanup` to preview cleanup. Never pass `--confirm-delete` or delete a remote branch unless the user explicitly requests it.

<!-- fizzyx:dev-workflow:end -->
