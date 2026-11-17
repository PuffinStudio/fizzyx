---
"@puffinstudio/fizzyx": minor
---

The default in-progress limit is now 20 instead of 5. `flow start` counts the in-progress cards of the token's user on the project's board; with one coordinating agent working a whole board, five was reached almost immediately. A project that sets `flow.wip_limit` keeps its own value.
