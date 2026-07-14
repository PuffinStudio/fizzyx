# Writing Agent Briefs

An agent brief is the durable implementation contract posted when work becomes ready for an agent. Describe behavior and interfaces, not current file paths or line numbers.

```markdown
## Agent Brief

**Category:** bug / enhancement
**Summary:** one-line outcome

**Current behavior:**
What happens now, including the failure or missing capability.

**Desired behavior:**
What must happen, including edge cases and errors.

**Key interfaces:**

- Domain type or command contract and the required change

**Acceptance criteria:**

- [ ] Independently verifiable behavior
- [ ] Failure and edge-case behavior
- [ ] Required tests or observable evidence

**Out of scope:**

- Adjacent behavior that must not change
```

The brief must remain useful after internal files move. Every criterion should be independently testable.
