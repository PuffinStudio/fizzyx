import { expect, test } from "bun:test";
import {
	planAdminScaffold,
	planAdminScaffoldBootstrap,
} from "../src/use-cases/openapi-admin-scaffold";

test("plans a Bun-only official Next.js and shadcn scaffold", () => {
	const commands = planAdminScaffold({
		framework: "nextjs",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
	});

	expect(commands.slice(0, 2)).toEqual([
		{
			argv: [
				"bun",
				"create",
				"next-app@latest",
				"/tmp/pet-admin",
				"--ts",
				"--tailwind",
				"--eslint",
				"--app",
				"--src-dir",
				"--import-alias",
				"@/*",
				"--use-bun",
				"--yes",
				"--disable-git",
			],
		},
		{
			argv: ["bunx", "--bun", "shadcn@latest", "init", "-d", "-c", "/tmp/pet-admin"],
		},
	]);
	expect(commands.flatMap((command) => command.argv)).not.toContain("npm");
	expect(commands.flatMap((command) => command.argv)).not.toContain("npx");
	expect(commands[2]?.argv).toEqual([
		"bun",
		"add",
		"@tanstack/react-query",
		"@tanstack/react-table",
		"@tanstack/react-form",
		"class-variance-authority",
		"clsx",
		"tailwind-merge",
		"--cwd",
		"/tmp/pet-admin",
	]);
	expect(commands.at(-1)?.argv).toEqual([
		"bunx",
		"--bun",
		"shadcn@latest",
		"add",
		"--all",
		"-y",
		"-c",
		"/tmp/pet-admin",
	]);
	expect(
		commands.some((command) => command.argv.join(" ").includes("add --dev oxlint oxfmt")),
	).toBe(true);
});

test("plans a Bun-only official TanStack Start and shadcn scaffold", () => {
	const commands = planAdminScaffold({
		framework: "tanstack-start",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
	});

	expect(commands[0]?.argv).toEqual([
		"bunx",
		"@tanstack/cli@latest",
		"create",
		"pet-admin",
		"--package-manager",
		"bun",
		"--framework",
		"React",
		"--add-ons",
		"tanstack-query",
		"--no-examples",
		"--no-git",
		"--target-dir",
		"/tmp/pet-admin",
		"-y",
	]);
	expect(commands.some((command) => command.argv.includes("init"))).toBe(false);
	expect(commands.at(-1)?.argv).toEqual([
		"bunx",
		"--bun",
		"shadcn@latest",
		"add",
		"--all",
		"-y",
		"-c",
		"/tmp/pet-admin",
	]);
	const bootstrap = planAdminScaffoldBootstrap({
		framework: "tanstack-start",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
	});
	expect(bootstrap.map((file) => file.path)).toEqual([
		"components.json",
		"src/lib/utils.ts",
		".oxlintrc.json",
		".oxfmtrc.json",
	]);
	expect(bootstrap[0]?.content).toContain('"css": "src/styles.css"');
	expect(bootstrap[0]?.content).toContain('"rsc": false');
	expect(commands.flatMap((command) => command.argv).join(" ")).not.toMatch(/\bnpm|\bnpx/);
});
