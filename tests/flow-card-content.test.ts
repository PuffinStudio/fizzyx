import { expect, test } from "bun:test";
import {
	convertDescription,
	parseDoneWhen,
	parseTemplateDescription,
	planStandardizeCardContent,
	planStepsFromDescription,
} from "../src/use-cases/flow-card-content";

test("parseTemplateDescription removes Steps section and normalizes template steps", () => {
	const description = `## Goal
Add parser support.

## Steps
- [x] Parse template section
- [ ] \`--radius-sm\` 降至 4rpx
- [ ] [Design token docs](https://example.com/design)
- [ ] ![radius token](assets/token.svg)
- [ ] **Plain**
- [ ] ~~Deprecated~~
- [ ] _Italic_
- [x] Parse template section

## Notes
Keep this.`;

	const parsed = parseTemplateDescription(description);

	expect(parsed.cardDescription).toBe(`## Goal
Add parser support.

## Notes
Keep this.`);
	expect(parsed.templateTags).toEqual([]);
	expect(parsed.templateSteps).toEqual([
		{ content: "Parse template section", completed: true },
		{ content: "--radius-sm 降至 4rpx", completed: false },
		{ content: "Design token docs", completed: false },
		{ content: "radius token", completed: false },
		{ content: "Plain", completed: false },
		{ content: "Deprecated", completed: false },
		{ content: "Italic", completed: false },
	]);
});

test("parseTemplateDescription preserves planner frontmatter when extracting steps", () => {
	const description = `---
priority: P1
type: feature
owner: ellen
---

## Goal
Keep metadata on add.

## Steps
- [ ] Create card
- [x] Preserve metadata`;

	const parsed = parseTemplateDescription(description);

	expect(parsed.cardDescription).toBe(`---
priority: P1
type: feature
owner: ellen
---

## Goal
Keep metadata on add.`);
	expect(parsed.templateTags).toEqual([]);
	expect(parsed.templateSteps).toEqual([
		{ content: "Create card", completed: false },
		{ content: "Preserve metadata", completed: true },
	]);
});

test("parseDoneWhen extracts markdown and html task lists", () => {
	const steps = parseDoneWhen(
		`- [x] Add linting &amp; tests
<li class="task-list-item"><input type="checkbox" checked><code>foo</code></li>
<li class="task-list-item"><input type="checkbox">Review UI</li>`,
	);

	expect(steps).toEqual([
		{ content: "Add linting & tests", completed: true },
		{ content: "foo", completed: true },
		{ content: "Review UI", completed: false },
	]);
});

test("planStepsFromDescription skips existing and duplicate steps", () => {
	const steps = planStepsFromDescription({
		description: `- [x] Add linting &amp; tests
- [ ] Review UI
- [ ] Add linting &amp; tests`,
		steps: [{ id: "existing", content: "Review UI", completed: false }],
	});

	expect(steps).toEqual([{ content: "Add linting & tests", completed: true }]);
});

test("planStandardizeCardContent plans description and step updates", () => {
	const plan = planStandardizeCardContent({
		number: 30,
		title: "Shrink radius tokens",
		description: `## Goal
Shrink radius tokens.

## Files
- \`src/app.css\`

## Done When
- bun test passes

## References
- stale figma node`,
		steps: [{ id: "s1", content: "`--radius-md` 降至 8rpx", completed: false }],
	});

	expect(plan.result).toEqual({
		number: 30,
		descriptionUpdated: true,
		stepsCreated: 0,
		stepsUpdated: 1,
		stepsCompleted: 0,
	});
	expect(plan.description).toContain("Goal");
	expect(plan.description).toContain("Shrink radius tokens.");
	expect(plan.description).toContain("Files");
	expect(plan.description).toContain("Verification");
	expect(plan.description).not.toContain("References");
	expect(plan.stepUpdates).toEqual([{ stepId: "s1", input: { content: "--radius-md 降至 8rpx" } }]);
	expect(plan.stepCreates).toEqual([]);
});

test("planStandardizeCardContent parses old done-when steps when none exist", () => {
	const plan = planStandardizeCardContent({
		number: 32,
		title: "Create steps",
		description: `## Goal
Do work.

## Done When
- [ ] \`pnpm check\` 通过
- [x] screenshot verified`,
		steps: [],
	});

	expect(plan.result.stepsCreated).toBe(2);
	expect(plan.stepCreates).toEqual([
		{ content: "pnpm check 通过", completed: false },
		{ content: "screenshot verified", completed: true },
	]);
});

test("planStandardizeCardContent completes closed card steps", () => {
	const plan = planStandardizeCardContent({
		number: 31,
		title: "Closed task",
		closed: true,
		descriptionHtml:
			"<div><h2>Goal</h2><p>Ship it.</p><h2>Done When</h2><ul><li><code>pnpm check</code> passed</li></ul></div>",
		steps: [{ id: "s1", content: "`old` step", completed: false }],
	});

	expect(plan.result.stepsUpdated).toBe(1);
	expect(plan.result.stepsCompleted).toBe(1);
	expect(plan.stepUpdates).toEqual([
		{ stepId: "s1", input: { content: "old step", completed: true } },
	]);
});

test("convertDescription preserves normal content", () => {
	expect(convertDescription("<div>html</div>")).toBe("<div>html</div>");
	expect(convertDescription("**bold**")).toBe("**bold**");
	expect(convertDescription("hello world")).toBe("hello world");
	expect(convertDescription("")).toBe("");
});

test("convertDescription renders normal markdown descriptions as html", () => {
	expect(convertDescription("## Goal\nKeep UI clean.")).toBe(`<h2>Goal</h2>
<p>Keep UI clean.</p>`);
	expect(convertDescription("- First\n- Second")).toBe(`<ul>
<li>First</li>
<li>Second</li>
</ul>`);
});

test("parseTemplateDescription extracts Tags section", () => {
	const parsed = parseTemplateDescription(`## Tags
- priority:p1
- type:feature
- depends_on:123

## Goal
Ship it.

## Steps
- [ ] Finish`);

	expect(parsed.templateTags).toEqual(["priority:p1", "type:feature", "depends_on:123"]);
	expect(parsed.cardDescription).toBe(`## Goal
Ship it.`);
	expect(parsed.templateSteps).toEqual([{ content: "Finish", completed: false }]);
});

test("convertDescription hides planner frontmatter from Fizzy UI", () => {
	expect(
		convertDescription(`---
priority: P2
type: chore
owner: Ellen
---

## Goal
Keep UI clean.`),
	).toBe(`<!--
priority: P2
type: chore
owner: Ellen
-->
<h2>Goal</h2>
<p>Keep UI clean.</p>`);
});

test("convertDescription renders hidden-metadata templates as html", () => {
	expect(
		convertDescription(`<!--
priority: P2
type: chore
-->

## Goal
Keep UI clean.

## Scope
- First
- Second`),
	).toBe(`<!--
priority: P2
type: chore
-->
<h2>Goal</h2>
<p>Keep UI clean.</p>
<h2>Scope</h2>
<ul>
<li>First</li>
<li>Second</li>
</ul>`);
});
