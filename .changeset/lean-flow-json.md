---
"@puffinstudio/fizzyx": minor
---

`flow --json` output is now sized for agents. The envelope is a single line instead of indented JSON, and card lists no longer carry descriptions: `flow list --json`, `flow search --json` and `flow work --json` return each card as `number`, `title`, `column`, `assignees` and, when the card has steps, `steps: { done, total }`. `flow work --json` returns `user`, `board` counts, `current`, `next` and `health` instead of the whole board cache. `flow show --json` returns the description once rather than as text and again as HTML.

**This changes the JSON shape.** A script that reads `description`, `descriptionHtml`, `tags` or the board cache from these commands must pass the new `--full` flag, which returns the previous data unchanged (still on one line).
