---
"@puffinstudio/fizzyx": patch
---

Status lines such as `✓ …` and `ℹ …` no longer carry ANSI colour codes when the output is not a terminal (or `NO_COLOR` is set), so piped and captured output is plain text.
