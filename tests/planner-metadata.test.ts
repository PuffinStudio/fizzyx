import { expect, test } from "bun:test";
import { analyzePlannerHealth } from "../src/use-cases/planner-service";
import type { PlannerCard } from "../src/use-cases/planner-service";
import { parsePlannerDescription, parsePlannerTags } from "../src/use-cases/planner-metadata";

test("parsePlannerDescription extracts frontmatter metadata and body", () => {
	const parsed = parsePlannerDescription(`---
priority: P1
type: feature
owner: ellen
depends_on: [123, #124]
blocks: 200, 201
api_status: not_connected
---

## Goal
Ship it`);

	expect(parsed.metadata.priority).toBe("P1");
	expect(parsed.metadata.type).toBe("feature");
	expect(parsed.metadata.owner).toBe("ellen");
	expect(parsed.metadata.depends_on).toEqual([123, 124]);
	expect(parsed.metadata.blocks).toEqual([200, 201]);
	expect(parsed.metadata.api_status).toBe("not_connected");
	expect(parsed.body).toContain("## Goal");
	expect(parsed.warnings).toEqual([]);
});

test("parsePlannerDescription tolerates missing closing delimiter", () => {
	const parsed = parsePlannerDescription("---\npriority: P0\nbody");
	expect(parsed.metadata.depends_on).toEqual([]);
	expect(parsed.body).toContain("priority: P0");
	expect(parsed.warnings).toEqual(["frontmatter is missing closing delimiter"]);
});

test("parsePlannerTags classifies project management tags", () => {
	const parsed = parsePlannerTags([
		"priority:p0",
		"type:bug",
		"area:frontend",
		"phase:integration",
		"custom",
	]);

	expect(parsed.priority).toEqual(["p0"]);
	expect(parsed.type).toEqual(["bug"]);
	expect(parsed.area).toEqual(["frontend"]);
	expect(parsed.phase).toEqual(["integration"]);
	expect(parsed.other).toEqual(["custom"]);
});

test("analyzePlannerHealth reports missing metadata and workflow risks", () => {
	const cards: PlannerCard[] = [
		makeCard({
			number: 1,
			lane: "todo",
			parsedTags: parsePlannerTags(["priority:p0"]),
			metadata: { type: "feature", depends_on: [], blocks: [] },
		}),
		makeCard({ number: 2, lane: "in_progress", lastActiveAt: "2026-01-01T00:00:00.000Z" }),
		makeCard({ number: 3, lane: "done" }),
		makeCard({
			number: 4,
			lane: "ready",
			metadata: { depends_on: [2], blocks: [], owner: "ellen", api_status: "not_connected" },
			parsedTags: parsePlannerTags(["priority:p1", "type:feature", "area:frontend"]),
		}),
	];

	const issues = analyzePlannerHealth(cards, new Date("2026-01-06T00:00:00.000Z"));
	expect(issues.map((issue) => issue.code)).toContain("p0_in_todo");
	expect(issues.map((issue) => issue.code)).toContain("stale_in_progress");
	expect(issues.map((issue) => issue.code)).toContain("dependency_not_done");
	expect(issues.map((issue) => issue.code)).toContain("frontend_api_not_connected");
});

const makeCard = (overrides: Partial<PlannerCard>): PlannerCard => ({
	number: 999,
	title: "Card",
	lane: "ready",
	closed: false,
	postponed: false,
	tags: [],
	parsedTags: parsePlannerTags([]),
	metadata: { depends_on: [], blocks: [] },
	metadataWarnings: [],
	body: "",
	assignees: [],
	steps: [],
	comments: [],
	stepProgress: { completed: 0, total: 0 },
	...overrides,
});
