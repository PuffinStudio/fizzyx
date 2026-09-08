# Changesets

Releases are driven from this folder, not from a hand-edited version number.

## Shipping a change

Add a changeset in the same PR as the change it describes:

```bash
bun changeset
```

Pick `patch`, `minor` or `major`, and write the line a user reading the changelog
needs — what changed for them, not what you edited. The command writes a small
markdown file here; commit it.

A PR with no user-visible change needs no changeset. Docs, tests, and internal
refactors are the usual cases.

## What happens after merge

Pushing to `main` runs `.github/workflows/release.yml`, which does one of two
things depending on whether changesets are waiting:

| State              | What the run does                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Changesets pending | Opens or updates a `chore: version packages` PR containing the version bump and the changelog. Nothing is published. |
| None pending       | The version PR has just been merged, so the bumped version is on `main`. Publishes it to npm.                        |

So publishing is gated on merging that PR — a deliberate act with the exact
version and changelog in front of you. Nobody runs `npm publish` by hand, and
the version in `package.json` is never edited directly.
