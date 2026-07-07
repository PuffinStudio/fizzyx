---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# TDD / Test-driven development

## The TDD Cycle

Build working software through a rapid, iterative cycle of test writing, production code, and refactoring.

---

### Phase 1: Triangulation

Before writing the first test, identify what you're going to build.

- What are the acceptance criteria?
- What's the smallest behavior that demonstrates value?

For a pure TDD exercise, **triangulate from the outside in**: what is the simplest end-to-end scenario that exercises this feature?

Otherwise, pick an entry point that maps to a **meaningful, testable increment** — usually a top-level function or a component's public interface, not an internal helper.

Output: one sentence describing the first test scenario.

---

### Phase 2: Red

Write a **failing** test. The test should:

- Assert the desired behaviour for one specific scenario.
- Compile and run, but fail — confirming the test is wired correctly and the feature doesn't exist yet.
- Be minimal: no abstractions, no helper factories, no fixtures — just what you need for this single case.

Commit `red`.

---

### Phase 3: Green

Write the **minimum** production code to pass the test.

- Hard-code a return value if that's what it takes.
- Ignore edge cases, performance, and aesthetics.
- Do not write code that isn't tested.

Commit `green`.

---

### Phase 4: Refactor

With all tests passing, improve the design of both production and test code:

- Remove duplication between tests and between production code.
- Improve naming.
- Extract helpers/abstractions — but only if they simplify.

After refactoring, all tests must still pass.

Commit `refactor`.

---

### Phase 5: Repeat

Return to **Phase 2 — Red** for the next scenario. The next scenario should be either:

- **The next edge case** uncovered by the current implementation (is your current solution too specific? generalize it).
- **The next acceptance criterion** in priority order.

---

## The rhythm

Red → Green → Refactor → Red → Green → Refactor → ...

Each cycle should be **seconds to minutes**, not hours. If a cycle drags, the increment is too large — make it smaller.

---

## Backfill testing

The above applies to greenfield TDD. If you are working on an **existing codebase** with no tests, use **backfill testing**:

1. Identify the **oldest, most stable** code — code that hasn't changed recently.
2. Test through the **public API** only: call a function, examine the return.
3. Use **property-based testing** (fast-check/vitest's `test.each`) to cover many inputs without writing many tests.
4. Add tests **before** making changes — so you know you haven't broken anything.

## Integration testing / stateful testing

Integration tests test the behaviour of a system of components wired together. They:

- Should be **scenario-based** — test a user journey, not a function.
- Should exercise **real infrastructure** where possible (test database, test HTTP server).
- Should test **state transitions** — given a known starting state, perform an action, assert the end state.

Tools: `supertest` for HTTP, `@playwright/test` for browser, `@effect/vitest` for Effect-based services.

---

## Test architecture

### Given / When / Then

Structure each test case with clear sections:

```typescript
// Given — set up the world
const user = await createUser({ plan: "free" });

// When — perform the action
const result = await upgradeToPro(user.id);

// Then — assert on the outcome
expect(result.success).toBe(true);
expect(user.plan).toBe("pro");
```

Never test implementation details: private methods, internal state, or module internals.

### Arrange / Act / Assert is the same structure with different words.

---

## Test double strategy

- **Use the real thing** unless it's slow, non-deterministic, or impossible (3rd-party API).
- **Fakes** are lightweight implementations of a real system (in-memory database, fake email sender). Prefer these.
- **Mocks** should be used sparingly and only at system boundaries. Never mock what you don't own.
- **Stubs** provide canned answers to calls made during the test. Use when you need specific error conditions.

---

## Co-located tests

Tests live next to the code they test:

```
src/
  billing/
    invoice.ts
    invoice.test.ts
    subscription.ts
    subscription.test.ts
```

## What to test

Test behaviour, not implementation:

| Test                   | Don't test                    |
| ---------------------- | ----------------------------- |
| Public API / interface | Private methods               |
| State transitions      | Internal state                |
| User-facing behaviour  | Framework internals           |
| Business logic         | Boilerplate/config            |
| Error handling         | Third-party library behaviour |
