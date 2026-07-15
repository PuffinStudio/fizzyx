import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	configureAdminQualityScripts,
	planAdminQualityCommands,
	planAdminTargetedQualityCommands,
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

test("plans regeneration fixes for generated source files only", () => {
	const paths = [
		"src/generated/admin-plan.ts",
		"src/app/(admin)/pets/page.tsx",
		".agents/skills/admin/SKILL.md",
		".env.example",
	];
	expect(planAdminTargetedQualityCommands("bun", paths)).toEqual([
		["bunx", "oxfmt", "src/generated/admin-plan.ts", "src/app/(admin)/pets/page.tsx"],
		["bunx", "oxlint", "src/generated/admin-plan.ts", "src/app/(admin)/pets/page.tsx", "--fix"],
	]);
	expect(planAdminTargetedQualityCommands("pnpm", paths)[0]).toEqual([
		"pnpm",
		"exec",
		"oxfmt",
		"src/generated/admin-plan.ts",
		"src/app/(admin)/pets/page.tsx",
	]);
});
