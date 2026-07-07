---
name: diagnosing-bugs
description: Debug failing behavior with a structured diagnosis pass.
---

# Diagnose / Debug failing behavior with a structured diagnosis pass

This is a 6-phase framework for diagnosing bugs.

Here is the Socratic dialogue which begins:

> **Bug diagnosis is the art of asking questions that are honest about what you don't know, and measuring against what you do.**

The phases are:

1. [**OBSERVATION**](#1-observation) — Collect all available data
2. [**CONTRACTION**](#2-contraction) — Narrow the search space
3. [**HYPOTHESIS**](#3-hypothesis) — Form a testable theory
4. [**EXPERIMENT**](#4-experiment) — Design a targeted measurement
5. [**JUDGEMENT**](#5-judgement) — Interpret the result
6. [**RESOLUTION**](#6-resolution) — Fix, verify, and learn

## 1. OBSERVATION

**Goal: Collect all available data without jumping to conclusions.**

- What was the expected behavior?
- What actually happened?
- When did this first appear? (recent deploy? specific commit?)
- Is it reproducible? (always? intermittently? specific environment/data?)
- What did the logs/metrics/traces say at the time of failure?
- What changed recently? (review `git log`, deployments, config changes, feature flags)
- Gather browser console, network tab, backend logs, error monitoring screenshots if available.

## 2. CONTRACTION

**Goal: Narrow the search space — shrink the suspect code, data, or environment.**

- Can the bug be reproduced with minimal steps? Strip away setup that doesn't contribute.
- Does it affect one user or all users?
- One environment or all environments?
- One browser/device or all browsers/devices?
- One data shape or all data shapes?
- Does it fail on the happy path or only on edge cases?
- `git bisect` to find the commit if it's a regression.

## 3. HYPOTHESIS

**Goal: Form a specific, testable, falsifiable theory.**

Bad: "Maybe the database is slow."
Good: "If the database query for user subscriptions has a full table scan, then adding a user with many subscriptions would cause >500ms response time."

Format: **"If [cause], then [measurable effect]"**

- State your hypothesis clearly in one sentence.
- The hypothesis must connect cause to effect in a way that can be tested.
- If you can't form a hypothesis, you haven't contracted enough. Go back to step 2.

## 4. EXPERIMENT

**Goal: Design a targeted measurement to test the hypothesis.**

- What is the least invasive way to test this?
- Can you add a targeted log line?
- Can you reproduce with a minimal code path (unit test, curl command, isolated script)?
- Can you toggle a feature flag or config value?
- What data would confirm the hypothesis? What data would disprove it?
- Run the experiment and collect the result.

## 5. JUDGEMENT

**Goal: Interpret the experiment results.**

- Did the experiment confirm the hypothesis? If so, you've found the root cause.
- Did it disprove the hypothesis? If so, return to step 2/3 — contract further and form a new hypothesis.
- Was the experiment inconclusive? Redesign and re-run.
- Be honest about ambiguity — don't force a conclusion.

## 6. RESOLUTION

**Goal: Fix, verify, and learn.**

- Write the fix. Keep it minimal — the smallest change that addresses the root cause.
- Add a test that would have caught this bug (if practical).
- Verify the fix in the same environment where the bug was reproduced.
- Consider: could this happen elsewhere in the codebase? Surface-level pattern or systemic issue?
- Log the resolution: what was the root cause, what was the fix, how long did it take to diagnose?
