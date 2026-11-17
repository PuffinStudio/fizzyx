---
"@puffinstudio/fizzyx": minor
---

The `AGENTS.md` section written by `fizzyx init` is rewritten for a card-driven, coordinator-plus-sub-agent workflow and is about half the size: five rules covering who touches cards, how a session starts, where sub-tasks are worked on, how a card is finished, and what needs the user's say-so. It no longer tells agents to pass `--json` everywhere, no longer points at skill files that may not exist, and no longer ties a card to a branch or a commit reference. The section now keeps a blank line inside each marker, which is what Markdown formatters produce, so `fizzyx init` and a format run stop rewriting each other's output. Text outside the markers is preserved as before.

Run `fizzyx init` in a project to pick up the new section.
