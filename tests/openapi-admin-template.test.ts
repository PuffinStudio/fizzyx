import { expect, test } from "bun:test";
import { renderTemplate } from "../src/use-cases/openapi-admin-template";

test("renders every declared admin template token exactly once or repeatedly", () => {
	const rendered = renderTemplate(
		"export const title = {{FIZZYX_TITLE}}\n// {{FIZZYX_TITLE}}\n{{FIZZYX_BODY}}",
		{
			FIZZYX_TITLE: JSON.stringify("Users"),
			FIZZYX_BODY: "export default function Page() {}",
		},
	);

	expect(rendered).toBe(
		'export const title = "Users"\n// "Users"\nexport default function Page() {}',
	);
});

test("rejects missing and unused template values", () => {
	expect(() => renderTemplate("{{FIZZYX_REQUIRED}}", {})).toThrow("FIZZYX_REQUIRED");
	expect(() => renderTemplate("plain", { FIZZYX_UNUSED: "value" })).toThrow("FIZZYX_UNUSED");
});
