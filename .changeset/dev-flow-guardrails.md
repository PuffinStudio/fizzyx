---
"@puffinstudio/fizzyx": minor
---

Fix the `dev` flow's guardrails. Several of them silently did the opposite of what they promised.

**`dev sync` and `dev status` now measure against `origin/<base>`.** `git fetch` advances
`origin/main`, never the local `main`, so syncing against the local branch was a no-op while
`ready` stayed blocked on a distance no `dev` command could close. `status` now reports
`behind_base` (what `sync` and `ready` act on) separately from `behind_upstream` (commits
someone else pushed to your branch, which `sync` deliberately does not touch); `behind` is
kept as an alias of `behind_base`. Set `dev.sync_from_remote: false` to keep comparing
against the local base branch.

**`dev checkpoint` stages only the files the current task touched**, untracked ones included,
instead of every tracked modification in the tree. `--all` is now the explicit escape that
also commits pre-existing changes, and it no longer drops untracked files while reporting
success. `checkpoint` also refuses to commit on a protected branch or a detached HEAD, where
the commit would have been reachable from nothing; `--allow-protected` overrides.

**`dev ready --squash` refuses to collapse commits that are already on a remote**, naming the
commit instead of rewriting published history into something only a force push could recover.

**`dev cleanup --confirm-delete` refuses to run with an uncommitted tree** rather than
carrying your changes onto the production branch when it switches.

**Failures now say what actually happened.** A failed `sync` prints git's real error and only
prints conflict-recovery steps when a rebase or merge is genuinely in progress; a failed
`ready` check prints the command's stderr (`check_output:` in `--agent` mode) instead of only
the command that failed.

`dev promote` no longer reports checks it cannot actually compute, `dev status` reaches the
`dev ready` next action once a branch has commits, and `dev start` and `dev doctor` work in a
repository with no commits yet.
