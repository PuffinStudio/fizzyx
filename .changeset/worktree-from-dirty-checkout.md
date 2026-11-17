---
"@puffinstudio/fizzyx": minor
---

`dev start --worktree` no longer refuses to run from a checkout with uncommitted changes. A linked worktree is a separate directory that neither touches nor carries those changes; the refusal remains for an in-place `dev start`, which would switch the dirty tree.
