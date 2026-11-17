---
"@puffinstudio/fizzyx": minor
---

`flow edit <card> --desc <file>` can now update a card that has no steps — a document or note, typically written in the web UI — from a description without a `## Steps` list. It used to refuse every such description. A card that already has steps still requires the list, so a task card cannot lose its checklist by accident, and `flow create` is unchanged.
