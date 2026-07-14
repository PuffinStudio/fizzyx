import { expect, test } from "bun:test";
import { decodePlannerSnapshot } from "../src/domain/planner-model";

const snapshot = {
	generatedAt: "2026-07-14T00:00:00.000Z",
	cache: "fresh",
	account: "1",
	board: "board-1",
	boardName: "Product",
	users: [],
	columns: [{ id: "todo", name: "Todo" }],
	tags: [],
	cards: [
		{
			number: 42,
			title: "Unify snapshot",
			lane: "todo",
			closed: false,
			postponed: false,
			tags: [],
			parsedTags: {
				priority: [],
				type: [],
				area: [],
				phase: [],
				dependsOn: [],
				blocks: [],
				other: [],
			},
			metadata: { depends_on: [], blocks: [] },
			metadataWarnings: [],
			body: "",
			assignees: [],
			steps: [],
			comments: [],
			stepProgress: { completed: 0, total: 0 },
		},
	],
	summary: {
		total: 1,
		lanes: { todo: 1, ready: 0, in_progress: 0, review: 0, done: 0, blocked: 0 },
		priorities: { p0: 0, p1: 0, p2: 0 },
		healthIssues: 0,
	},
	health: [],
	recommendations: [],
};

test("decodePlannerSnapshot accepts the shared serialized contract", () => {
	const decoded = decodePlannerSnapshot(snapshot);
	expect(decoded.board).toBe("board-1");
	expect(decoded.cards[0]?.metadataWarnings).toEqual([]);
});

test("decodePlannerSnapshot rejects browser/server contract drift", () => {
	const invalid = structuredClone(snapshot);
	delete (invalid.cards[0] as { metadataWarnings?: string[] }).metadataWarnings;
	expect(() => decodePlannerSnapshot(invalid)).toThrow("metadataWarnings must be an array");
});
