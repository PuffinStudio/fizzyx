---
"@puffinstudio/fizzyx": minor
---

The bundled `dev-workflow` skill is rewritten to match the card-driven workflow and is about a quarter of its former size: coordinator steps, sub-agent steps, housekeeping and hard limits. It now recommends text output over `--json`, describes `flow done` without a commit reference, and no longer presents a card-to-branch link (`dev start --card` still works). `flow work` no longer suggests `tdd` and `coding-standards` by default for a card's type, the built-in card template no longer lists `tdd` under suggested skills, and the `flow work` text output drops its `git guardrail` hint.

Run `fizzyx skill update --global` (or `--project`) to pick up the new skill text.
