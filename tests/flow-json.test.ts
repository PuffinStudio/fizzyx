import { expect, test } from "bun:test";
import { flowJson } from "../src/cli/flow-json";

test("flowJson emits the stable agent success envelope", () => {
	const output = flowJson([{ number: 42 }], "1 card", [
		{ action: "show", cmd: "fizzyx flow show 42", description: "View the card" },
	]);

	expect(JSON.parse(output)).toEqual({
		ok: true,
		data: [{ number: 42 }],
		summary: "1 card",
		breadcrumbs: [{ action: "show", cmd: "fizzyx flow show 42", description: "View the card" }],
	});
});
