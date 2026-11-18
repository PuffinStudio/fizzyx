# @puffinstudio/fizzyx

## 1.5.1

### Patch Changes

- [#5](https://github.com/PuffinStudio/fizzyx/pull/5) [`cb22229`](https://github.com/PuffinStudio/fizzyx/commit/cb22229564163c0eb604c9d755a6790d531e381c) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `flow edit --desc` now sets the card's tags to the draft's `## Tags` section instead of toggling them, so running the same edit twice gives the same result. A leading `# <title>` line in a `flow create` or `flow edit` draft is used as the card title and no longer ends up in the description.

## 1.5.0

### Minor Changes

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - The `AGENTS.md` section written by `fizzyx init` is rewritten for a card-driven, coordinator-plus-sub-agent workflow and is about half the size: five rules covering who touches cards, how a session starts, where sub-tasks are worked on, how a card is finished, and what needs the user's say-so. It no longer tells agents to pass `--json` everywhere, no longer points at skill files that may not exist, and no longer ties a card to a branch or a commit reference. The section now keeps a blank line inside each marker, which is what Markdown formatters produce, so `fizzyx init` and a format run stop rewriting each other's output. Text outside the markers is preserved as before.

  Run `fizzyx init` in a project to pick up the new section.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Add `flow.card.language` (`en`, the default, or `zh-CN`) to `.fizzyx.yaml`. It sets the language of what goes on the Fizzy board and nothing else: the guidance text of the built-in card template used by `flow create --draft`, and one line in the generated `AGENTS.md` section telling agents which language to write card titles, descriptions, steps and comments in. CLI output, JSON keys, command names, commits and branch names are unaffected, and the section headings FizzyX finds by name (`## Tags`, `## Steps`, …) stay English in every language. A project-local `.agents/skills/fizzyx/CARD_TEMPLATE.md` still takes precedence over the built-in template.

  ```yaml
  flow:
    card:
      language: zh-CN
  ```

  Run `fizzyx init` afterwards to refresh the `AGENTS.md` section.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - The default in-progress limit is now 20 instead of 5. `flow start` counts the in-progress cards of the token's user on the project's board; with one coordinating agent working a whole board, five was reached almost immediately. A project that sets `flow.wip_limit` keeps its own value.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - The bundled `dev-workflow` skill is rewritten to match the card-driven workflow and is about a quarter of its former size: coordinator steps, sub-agent steps, housekeeping and hard limits. It now recommends text output over `--json`, describes `flow done` without a commit reference, and no longer presents a card-to-branch link (`dev start --card` still works). `flow work` no longer suggests `tdd` and `coding-standards` by default for a card's type, the built-in card template no longer lists `tdd` under suggested skills, and the `flow work` text output drops its `git guardrail` hint.

  Run `fizzyx skill update --global` (or `--project`) to pick up the new skill text.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `dev doctor` and `dev cleanup` now recognise work that reached the base branch by cherry-pick, rebase or a one-to-one squash: a branch counts as integrated when every one of its commits has a patch-equivalent commit on the base, not only when its tip is an ancestor.

  `dev doctor` analyses every local branch whatever its prefix, and replaces the "no upstream" list, which named nearly every local branch, with `local_only`: branches holding commits that are on no remote and not on the base — the work that exists only in this clone. It prints section counts by default and names only the `local_only` branches; `--verbose` lists every section.

  `dev cleanup --confirm-delete` deletes cherry-picked branches too, and stays conservative about it:

  - Only branches in a work role (the built-in `feature/`, `fix/`, … prefixes or your `dev.branch_prefixes`) are deleted. An integrated branch with any other prefix is reported and left alone.
  - Before a cherry-picked branch is removed its tip is pinned at `refs/fizzyx/deleted/<branch>`; `git branch <branch> refs/fizzyx/deleted/<branch>` restores it. Ancestry-merged branches are still removed with `git branch -d`.
  - A branch is not treated as integrated when it contains a merge commit, when one of its landed commits was later reverted on the base, or when git cannot answer one of the comparisons. Those branches are listed under `local_only` with the reason.
  - The preview lists exactly the branches that would be deleted, each with its reason.

  A configured base branch (`dev.production_branch`, `dev.default_base`, `dev start --base`) must now be a plain branch name; a value git could read as an option is rejected.

  **Output change for scripts:** the `no_upstream` key of `dev doctor --agent` is gone (`local_only` is not the same list), and sections other than `local_only` no longer print their entries without `--verbose`.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `flow edit <card> --desc <file>` can now update a card that has no steps — a document or note, typically written in the web UI — from a description without a `## Steps` list. It used to refuse every such description. A card that already has steps still requires the list, so a task card cannot lose its checklist by accident, and `flow create` is unchanged.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `fizzyx flow done <card>` no longer reads git. Without a second argument it used to derive a reference from the current directory's HEAD, which failed whenever the tree had uncommitted changes or was not a repository, and otherwise recorded whatever commit happened to be checked out. It now simply closes the card. The optional second argument is a free-text closing note; a `done:` comment is posted only when one is given. Unfinished steps still block closing unless `--complete-steps` is passed.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Add `fizzyx flow work --agent`: a status of at most eight lines for the start of a session. It lists your in-progress cards with their step progress and first unchecked step, then the card to pick up next, so an agent no longer needs `flow work` followed by `flow show` on every card to learn what is left.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `dev ready` now says when it verified nothing. In a project with no `dev.checks.ready` commands it used to print `ready: yes`, which reads as "the checks passed" although none exist; it now adds `checks: none configured` (and the plain-text mode says the same), so the result is understood as branch state only.

  `dev status --agent` is shorter: the fixed `dirty_policy` sentence is gone (the `next_action` line already gives that guidance when the tree is dirty), and so is `behind`, the alias of `behind_base` that 1.4.0 kept for one release. **A script still reading `behind` must read `behind_base`.**

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `flow --json` output is now sized for agents. The envelope is a single line instead of indented JSON, and card lists no longer carry descriptions: `flow list --json`, `flow search --json` and `flow work --json` return each card as `number`, `title`, `column`, `assignees` and, when the card has steps, `steps: { done, total }`. `flow work --json` returns `user`, `board` counts, `current`, `next` and `health` instead of the whole board cache. `flow show --json` returns the description once rather than as text and again as HTML.

  **This changes the JSON shape.** A script that reads `description`, `descriptionHtml`, `tags` or the board cache from these commands must pass the new `--full` flag, which returns the previous data unchanged (still on one line).

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `dev start --worktree` no longer refuses to run from a checkout with uncommitted changes. A linked worktree is a separate directory that neither touches nor carries those changes; the refusal remains for an in-place `dev start`, which would switch the dirty tree.

### Patch Changes

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Status lines such as `✓ …` and `ℹ …` no longer carry ANSI colour codes when the output is not a terminal (or `NO_COLOR` is set), so piped and captured output is plain text.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `flow search` and `flow list --search` handle Fizzy's search rate limit. When the server answers `429` with a `Retry-After` of a minute or less, FizzyX waits that long once and retries; a longer wait, or a second refusal, fails with a message that says search is rate-limited and when to try again, instead of a bare `HTTP 429`. A numeric search that the server answers with the single card of that number is returned as a one-card list.

- [#3](https://github.com/PuffinStudio/fizzyx/pull/3) [`d67e0ab`](https://github.com/PuffinStudio/fizzyx/commit/d67e0abc227bc4517b428e55be82cc53a916f88a) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Generated `wx` clients accept an application-owned JSON `transport` in `configure()`, so a mini program that already runs its own session can route requests through it. Generated types now quote nested property names that are not identifiers, keep `null`, `const` and literal `enum` values, and parenthesise union array items.

## 1.4.0

### Minor Changes

- [#1](https://github.com/PuffinStudio/fizzyx/pull/1) [`b2bad7b`](https://github.com/PuffinStudio/fizzyx/commit/b2bad7b9dcfaa6ff9b7d67fd2482c5c3ee80f4d2) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Fix the `dev` flow's guardrails. Several of them silently did the opposite of what they promised.

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

### Patch Changes

- [#1](https://github.com/PuffinStudio/fizzyx/pull/1) [`b2bad7b`](https://github.com/PuffinStudio/fizzyx/commit/b2bad7b9dcfaa6ff9b7d67fd2482c5c3ee80f4d2) Thanks [@ryuhzk](https://github.com/ryuhzk)! - `fizzyx dev start` now works in a project without a `.fizzyx.yaml`, like every other `dev` command already did.

- [#1](https://github.com/PuffinStudio/fizzyx/pull/1) [`b2bad7b`](https://github.com/PuffinStudio/fizzyx/commit/b2bad7b9dcfaa6ff9b7d67fd2482c5c3ee80f4d2) Thanks [@ryuhzk](https://github.com/ryuhzk)! - Fix two bundled skills that sent agents to content that does not exist.

  `improve-codebase` told the agent to run `/codebase-design` for the architecture
  vocabulary (**seam**, **leverage**, **locality**, **depth**) and three principles (the
  deletion test, "the interface is the test surface", "one adapter is a hypothetical seam,
  two is a real one") — none of which appear in that skill. An agent following the
  instruction found nothing and then had to invent the vocabulary it was told to use
  exactly. Those definitions now live in `improve-codebase` itself, along with what to do
  when exploring alternative interfaces, which had pointed at a "design-it-twice parallel
  sub-agent pattern" that likewise was not there.

  `codebase-design` ended its "Deepen" pass by telling the agent to run a `/deepen`
  command. No such command exists; the skill that scans for deepening opportunities is
  `improve-codebase`, which it now names.

  Run `fizzyx skill update --global` (or `--project`) to pick these up.
