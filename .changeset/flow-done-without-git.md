---
"@puffinstudio/fizzyx": minor
---

`fizzyx flow done <card>` no longer reads git. Without a second argument it used to derive a reference from the current directory's HEAD, which failed whenever the tree had uncommitted changes or was not a repository, and otherwise recorded whatever commit happened to be checked out. It now simply closes the card. The optional second argument is a free-text closing note; a `done:` comment is posted only when one is given. Unfinished steps still block closing unless `--complete-steps` is passed.
