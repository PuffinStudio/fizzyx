import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	configureAdminQualityScripts,
	planAdminQualityCommands,
} from "../src/use-cases/openapi-admin-quality";

test("adds OXC quality scripts without removing official scaffold scripts", () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-admin-quality-"));
	try {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ scripts: { dev: "vite dev", build: "vite build" } }),
		);

		configureAdminQualityScripts(root);

		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		expect(pkg.scripts).toEqual({
			dev: "vite dev",
			build: "vite build",
			fmt: "oxfmt .",
			"fmt:check": "oxfmt --check .",
			lint: "oxlint .",
			"lint:fix": "oxlint . --fix",
			check: "oxfmt --check . && oxlint .",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("plans package-manager-consistent post-generation fixes", () => {
	expect(planAdminQualityCommands("bun")).toEqual([
		["bun", "run", "fmt"],
		["bun", "run", "lint:fix"],
	]);
	expect(planAdminQualityCommands("pnpm")).toEqual([
		["pnpm", "run", "fmt"],
		["pnpm", "run", "lint:fix"],
	]);
});
