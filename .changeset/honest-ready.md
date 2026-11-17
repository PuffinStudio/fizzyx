---
"@puffinstudio/fizzyx": minor
---

`dev ready` now says when it verified nothing. In a project with no `dev.checks.ready` commands it used to print `ready: yes`, which reads as "the checks passed" although none exist; it now adds `checks: none configured` (and the plain-text mode says the same), so the result is understood as branch state only.

`dev status --agent` is shorter: the fixed `dirty_policy` sentence is gone (the `next_action` line already gives that guidance when the tree is dirty), and so is `behind`, the alias of `behind_base` that 1.4.0 kept for one release. **A script still reading `behind` must read `behind_base`.**
