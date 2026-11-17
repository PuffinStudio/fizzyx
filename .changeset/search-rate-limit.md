---
"@puffinstudio/fizzyx": patch
---

`flow search` and `flow list --search` handle Fizzy's search rate limit. When the server answers `429` with a `Retry-After` of a minute or less, FizzyX waits that long once and retries; a longer wait, or a second refusal, fails with a message that says search is rate-limited and when to try again, instead of a bare `HTTP 429`. A numeric search that the server answers with the single card of that number is returned as a one-card list.
