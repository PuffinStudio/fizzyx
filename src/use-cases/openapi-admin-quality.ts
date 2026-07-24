import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AdminFramework, AdminPackageManager } from "./openapi-admin-scaffold";

export interface AdminQualityFile {
	path: string;
	content: string;
}

export const adminQualityBootstrapFiles = (framework: AdminFramework): AdminQualityFile[] => [
	{
		path: ".oxlintrc.json",
		content: `${JSON.stringify(
			{
				$schema: "./node_modules/oxlint/configuration_schema.json",
				plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y"],
				categories: { correctness: "error" },
				rules: {},
				env: { builtin: true },
				ignorePatterns: [
					"src/routeTree.gen.ts",
					"src/components/ui/**",
					...(framework === "tanstack-start" ? ["src/router.tsx"] : []),
				],
			},
			null,
			2,
		)}\n`,
	},
	{
		path: ".oxfmtrc.json",
		content: `${JSON.stringify(
			{ ignorePatterns: ["src/routeTree.gen.ts", ".fizzyx/**"] },
			null,
			2,
		)}\n`,
	},
];

export const configureAdminQualityScripts = (root: string): void => {
	const path = join(root, "package.json");
	const pkg = JSON.parse(readFileSync(path, "utf8")) as {
		[key: string]: unknown;
		scripts?: Record<string, string>;
	};
	pkg.scripts = {
		...pkg.scripts,
		fmt: "oxfmt .",
		"fmt:check": "oxfmt --check .",
		lint: "oxlint .",
		"lint:fix": "oxlint . --fix",
		check: "oxfmt --check . && oxlint .",
	};
	writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
};

export const planAdminQualityCommands = (packageManager: AdminPackageManager): string[][] =>
	packageManager === "bun"
		? [
				["bun", "run", "fmt"],
				["bun", "run", "lint:fix"],
			]
		: [
				["pnpm", "run", "fmt"],
				["pnpm", "run", "lint:fix"],
			];

export const planAdminTargetedQualityCommands = (
	packageManager: AdminPackageManager,
	paths: string[],
): string[][] => {
	const sourcePaths = paths.filter((path) => /\.[cm]?[jt]sx?$/.test(path));
	if (!sourcePaths.length) return [];
	return packageManager === "bun"
		? [
				["bunx", "oxfmt", ...sourcePaths],
				["bunx", "oxlint", ...sourcePaths, "--fix"],
			]
		: [
				["pnpm", "exec", "oxfmt", ...sourcePaths],
				["pnpm", "exec", "oxlint", ...sourcePaths, "--fix"],
			];
};
