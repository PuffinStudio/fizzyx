# Domain Context Format

`CONTEXT.md` is a glossary, not an implementation guide. Keep entries alphabetical and describe business meaning without file names, database tables, or framework terms.

```markdown
# Domain Context

## Term

A short definition in the language used by domain experts.

**Not:** A nearby term this must not be confused with.

**Examples:**

- A representative valid case
- An edge case that clarifies the definition
```

Update an existing entry instead of creating synonyms. When two contexts use the same word differently, keep separate `CONTEXT.md` files and describe the relationship in `CONTEXT-MAP.md`.
