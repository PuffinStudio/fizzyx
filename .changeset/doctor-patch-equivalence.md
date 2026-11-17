---
"@puffinstudio/fizzyx": minor
---

`dev doctor` and `dev cleanup` now recognise work that reached the base branch by cherry-pick, rebase or a one-to-one squash. A branch counts as integrated when every one of its commits has a patch-equivalent commit on the base, not only when its tip is an ancestor, and branches are judged whatever their prefix (a `rework/…` branch used to be invisible to both commands). `dev cleanup --confirm-delete` deletes such branches too; a branch that contains a merge commit is never treated as integrated this way.

`dev doctor` replaces the "no upstream" list, which named nearly every local branch, with `local_only`: branches holding commits that are on no remote and not on the base — the work that exists only in this clone. It prints section counts by default and names only the `local_only` branches; `--verbose` lists every section. `dev cleanup` names the branches in its preview up to ten and otherwise prints the count; `--verbose` names them all.

**Output change for scripts:** the `no_upstream` key of `dev doctor --agent` is gone (`local_only` is not the same list), and sections other than `local_only` no longer print their entries without `--verbose`.
