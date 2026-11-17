---
"@puffinstudio/fizzyx": minor
---

Add `dev.worktree_dir` to choose where `dev start --worktree` creates worktrees, one sub-directory per branch. A relative path is resolved against the main checkout from wherever the command runs, so `worktree_dir: ../myrepo-worktrees` keeps every worktree beside the repository instead of inside `.git/fizzyx/worktrees` (still the default when the key is unset).

`dev start --worktree` no longer refuses to run from a checkout with uncommitted changes. A linked worktree is a separate directory that neither touches nor carries those changes; the refusal remains for an in-place `dev start`, which would switch the dirty tree.
