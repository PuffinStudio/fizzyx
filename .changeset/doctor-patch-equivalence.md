---
"@puffinstudio/fizzyx": minor
---

`dev doctor` and `dev cleanup` now recognise work that reached the base branch by cherry-pick, rebase or a one-to-one squash: a branch counts as integrated when every one of its commits has a patch-equivalent commit on the base, not only when its tip is an ancestor.

`dev doctor` analyses every local branch whatever its prefix, and replaces the "no upstream" list, which named nearly every local branch, with `local_only`: branches holding commits that are on no remote and not on the base — the work that exists only in this clone. It prints section counts by default and names only the `local_only` branches; `--verbose` lists every section.

`dev cleanup --confirm-delete` deletes cherry-picked branches too, and stays conservative about it:

- Only branches in a work role (the built-in `feature/`, `fix/`, … prefixes or your `dev.branch_prefixes`) are deleted. An integrated branch with any other prefix is reported and left alone.
- Before a cherry-picked branch is removed its tip is pinned at `refs/fizzyx/deleted/<branch>`; `git branch <branch> refs/fizzyx/deleted/<branch>` restores it. Ancestry-merged branches are still removed with `git branch -d`.
- A branch is not treated as integrated when it contains a merge commit, when one of its landed commits was later reverted on the base, or when git cannot answer one of the comparisons. Those branches are listed under `local_only` with the reason.
- The preview lists exactly the branches that would be deleted, each with its reason.

A configured base branch (`dev.production_branch`, `dev.default_base`, `dev start --base`) must now be a plain branch name; a value git could read as an option is rejected.

**Output change for scripts:** the `no_upstream` key of `dev doctor --agent` is gone (`local_only` is not the same list), and sections other than `local_only` no longer print their entries without `--verbose`.
