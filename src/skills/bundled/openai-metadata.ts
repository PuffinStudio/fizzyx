export const BUNDLED_OPENAI_METADATA: Readonly<Record<string, string>> = {
	"code-review": `interface:
  display_name: "Code Review"
  short_description: "Review a diff on standards and spec"
`,
	"codebase-design": `interface:
  display_name: "Codebase Design"
  short_description: "Vocabulary for deep-module design"
`,
	"diagnosing-bugs": `interface:
  display_name: "Diagnosing Bugs"
  short_description: "Diagnose hard bugs and regressions"
`,
	"domain-modeling": `interface:
  display_name: "Domain Modeling"
  short_description: "Build and sharpen a domain model"
`,
	handoff: `interface:
  display_name: "Handoff"
  short_description: "Compact a conversation into a handoff"
policy:
  allow_implicit_invocation: false
`,
	"improve-codebase": `interface:
  display_name: "Improve Codebase Architecture"
  short_description: "Find and grill architecture improvements"
policy:
  allow_implicit_invocation: false
`,
	prototype: `interface:
  display_name: "Prototype"
  short_description: "Prototype to answer a design question"
`,
	research: `interface:
  display_name: "Research"
  short_description: "Research from high-trust sources"
`,
	tdd: `interface:
  display_name: "TDD"
  short_description: "Test-driven red-green-refactor"
`,
	"to-prd": `interface:
  display_name: "To PRD"
  short_description: "Turn a conversation into a PRD"
policy:
  allow_implicit_invocation: false
`,
	"to-issues": `interface:
  display_name: "To Issues"
  short_description: "Split a plan into tracer-bullet issues"
policy:
  allow_implicit_invocation: false
`,
	triage: `interface:
  display_name: "Triage"
  short_description: "Move issues through triage roles"
policy:
  allow_implicit_invocation: false
`,
};
