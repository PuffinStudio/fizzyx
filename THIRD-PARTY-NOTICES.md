# Third-party notices

This package's own code is MIT, © 2026 Puffin Studio (see [`LICENSE`](LICENSE)).
Some of the bundled skills are not its own work. They are listed here with what
is known about where they came from and under what terms.

The skill markdown is inlined into `dist/main.js` at build time, so a published
`@puffinstudio/fizzyx` carries this content — which is why this file ships with
the package rather than only living in the repository.

---

## mattpocock/skills — MIT, © 2026 Matt Pocock

<https://github.com/mattpocock/skills>

The skills below are derived from that repository. Most have been rewritten in
this project's own voice and re-pointed at `fizzyx flow` / `fizzyx dev` commands
in place of upstream's tracker-specific instructions, and several accompanying
reference files were condensed. They remain derivative works.

| Bundled file                                  | Upstream source                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| `code-review.md`                              | `skills/engineering/code-review/SKILL.md`                                    |
| `domain-modeling.md`                          | `skills/engineering/domain-modeling/SKILL.md`                                |
| `handoff.md`                                  | `skills/productivity/handoff/SKILL.md`                                       |
| `improve-codebase.md`                         | `skills/engineering/improve-codebase-architecture/SKILL.md`                  |
| `prototype.md`                                | `skills/engineering/prototype/SKILL.md`                                      |
| `research.md`                                 | `skills/engineering/research/SKILL.md`                                       |
| `to-issues.md`                                | `skills/engineering/to-tickets/SKILL.md` (upstream renamed from `to-issues`) |
| `to-prd.md`                                   | `skills/engineering/to-spec/SKILL.md` (upstream renamed from `to-prd`)       |
| `triage.md`                                   | `skills/engineering/triage/SKILL.md`                                         |
| `resources/domain-modeling/ADR-FORMAT.md`     | `skills/engineering/domain-modeling/ADR-FORMAT.md`                           |
| `resources/domain-modeling/CONTEXT-FORMAT.md` | `skills/engineering/domain-modeling/CONTEXT-FORMAT.md`                       |
| `resources/improve-codebase/HTML-REPORT.md`   | `skills/engineering/improve-codebase-architecture/HTML-REPORT.md`            |
| `resources/prototype/LOGIC.md`                | `skills/engineering/prototype/LOGIC.md`                                      |
| `resources/prototype/UI.md`                   | `skills/engineering/prototype/UI.md`                                         |
| `resources/triage/AGENT-BRIEF.md`             | `skills/engineering/triage/AGENT-BRIEF.md`                                   |
| `resources/triage/OUT-OF-SCOPE.md`            | `skills/engineering/triage/OUT-OF-SCOPE.md`                                  |

Paths are relative to `src/skills/bundled/` here and to the upstream repository
root there. Content was last checked against `mattpocock/skills@66898f6`
(2026-07-13); see `src/use-cases/skill-service.ts`.

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Origin not established

These three are **not** from `mattpocock/skills`, despite a commit message in
this repository's history saying otherwise. Their content does not appear
anywhere in that repository's full history:

| Bundled file         | Distinguishing content                                                       | Searched for                                  |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| `codebase-design.md` | "Pass 1: Explore" through "Pass 5: Implement"                                | `Pass 1: Explore` — no match                  |
| `tdd.md`             | "Phase 1: Triangulation", red/green/refactor                                 | `Triangulation` — no match                    |
| `diagnosing-bugs.md` | OBSERVATION / CONTRACTION / HYPOTHESIS / EXPERIMENT / JUDGEMENT / RESOLUTION | `Socratic dialogue`, `CONTRACTION` — no match |

Upstream has skills by the same names, but with entirely different content.
Until the real source is identified these are listed as unknown rather than
credited to an author who may not have written them. If you recognise this
material, please open an issue.

---

## security-review.md

Carries `metadata.origin: ECC` in its own front matter. Terms not established
here.
