---
"@puffinstudio/fizzyx": patch
---

`flow edit --desc` now sets the card's tags to the draft's `## Tags` section instead of toggling them, so running the same edit twice gives the same result. A leading `# <title>` line in a `flow create` or `flow edit` draft is used as the card title and no longer ends up in the description.
