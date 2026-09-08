---
"@puffinstudio/fizzyx": patch
---

Fix two bundled skills that sent agents to content that does not exist.

`improve-codebase` told the agent to run `/codebase-design` for the architecture
vocabulary (**seam**, **leverage**, **locality**, **depth**) and three principles (the
deletion test, "the interface is the test surface", "one adapter is a hypothetical seam,
two is a real one") — none of which appear in that skill. An agent following the
instruction found nothing and then had to invent the vocabulary it was told to use
exactly. Those definitions now live in `improve-codebase` itself, along with what to do
when exploring alternative interfaces, which had pointed at a "design-it-twice parallel
sub-agent pattern" that likewise was not there.

`codebase-design` ended its "Deepen" pass by telling the agent to run a `/deepen`
command. No such command exists; the skill that scans for deepening opportunities is
`improve-codebase`, which it now names.

Run `fizzyx skill update --global` (or `--project`) to pick these up.
