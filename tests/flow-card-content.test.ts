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
	expect(plan.description).toContain("<h2>Goal</h2>");
	expect(plan.description).toContain("Shrink radius tokens.");
	expect(plan.description).toContain("<h2>Files</h2>");
	expect(plan.description).toContain("<h2>Verification</h2>");
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

test("convertDescription converts rich text and passes through plain text", () => {
	expect(convertDescription("<div>html</div>")).toInclude("html");
	expect(convertDescription("**bold**")).toInclude("<strong>bold</strong>");
	expect(convertDescription("- [x] done")).toInclude('type="checkbox"');
	expect(convertDescription("hello world")).toBe("hello world");
	expect(convertDescription("")).toBe("");
});
