---
"@puffinstudio/fizzyx": minor
---

Add `flow.card.language` (`en`, the default, or `zh-CN`) to `.fizzyx.yaml`. It sets the language of what goes on the Fizzy board and nothing else: the guidance text of the built-in card template used by `flow create --draft`, and one line in the generated `AGENTS.md` section telling agents which language to write card titles, descriptions, steps and comments in. CLI output, JSON keys, command names, commits and branch names are unaffected, and the section headings FizzyX finds by name (`## Tags`, `## Steps`, …) stay English in every language. A project-local `.agents/skills/fizzyx/CARD_TEMPLATE.md` still takes precedence over the built-in template.

```yaml
flow:
  card:
    language: zh-CN
```

Run `fizzyx init` afterwards to refresh the `AGENTS.md` section.
