---
"@puffinstudio/fizzyx": patch
---

Generated `wx` clients accept an application-owned JSON `transport` in `configure()`, so a mini program that already runs its own session can route requests through it. Generated types now quote nested property names that are not identifiers, keep `null`, `const` and literal `enum` values, and parenthesise union array items.
