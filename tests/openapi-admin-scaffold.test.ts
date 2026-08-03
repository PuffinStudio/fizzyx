import { expect, test } from "bun:test";
import {
	FIZZYX_ADMIN_PRESET,
	adminSourcePath,
	planAdminScaffold,
	planAdminScaffoldBootstrap,
	resolveAdminPreset,
} from "../src/use-cases/openapi-admin-scaffold";

test("plans a Bun-only official Next.js and shadcn scaffold", () => {
	const commands = planAdminScaffold({
		framework: "nextjs",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
	});

	expect(commands[0]).toEqual({
		argv: [
			"bunx",
			"--bun",
			"shadcn@latest",
			"init",
			"--template",
			"next",
			"--name",
			"pet-admin",
			"--base",
			"base",
			"--preset",
			FIZZYX_ADMIN_PRESET,
			"--yes",
			"--cwd",
			"/tmp",
		],
	});
	expect(commands.flatMap((command) => command.argv)).not.toContain("npm");
	expect(commands.flatMap((command) => command.argv)).not.toContain("npx");
	expect(commands[1]?.argv).toEqual([
		"bun",
		"add",
		"@tanstack/react-query",
		"@tanstack/react-table",
		"@tanstack/react-form",
		"zod@latest",
		"@autoform/zod",
		"@autoform/react",
		"class-variance-authority",
		"clsx",
		"tailwind-merge",
		"next-themes",
		"--cwd",
		"/tmp/pet-admin",
	]);
	expect(commands.at(-1)?.argv).toEqual([
		"bunx",
		"--bun",
		"shadcn@latest",
		"add",
		"--all",
		"--overwrite",
		"-y",
		"-c",
		"/tmp/pet-admin",
	]);
	expect(commands.at(-2)?.argv).toEqual([
		"bunx",
		"--bun",
		"shadcn@latest",
		"add",
		"https://raw.githubusercontent.com/vantezzen/autoform/refs/heads/main/packages/shadcn/registry/autoform-tanstack.json",
		"-y",
		"-c",
		"/tmp/pet-admin",
	]);
	expect(
		commands.some((command) => command.argv.join(" ").includes("add --dev oxlint oxfmt")),
	).toBe(true);
});

test("matches the source layouts owned by current shadcn templates", () => {
	expect(adminSourcePath("nextjs", "app/page.tsx")).toBe("app/page.tsx");
	expect(adminSourcePath("tanstack-start", "routes/index.tsx")).toBe("src/routes/index.tsx");
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
		"--bun",
		"shadcn@latest",
		"init",
		"--template",
		"start",
		"--name",
		"pet-admin",
		"--base",
		"base",
		"--preset",
		FIZZYX_ADMIN_PRESET,
		"--yes",
		"--cwd",
		"/tmp",
	]);
	expect(commands.some((command) => command.argv.includes("@tanstack/cli@latest"))).toBe(false);
	expect(commands.at(-1)?.argv).toEqual([
		"bunx",
		"--bun",
		"shadcn@latest",
		"add",
		"--all",
		"--overwrite",
		"-y",
		"-c",
		"/tmp/pet-admin",
	]);
	expect(commands.at(-2)?.argv.some((value) => value.endsWith("autoform-tanstack.json"))).toBe(
		true,
	);
	const bootstrap = planAdminScaffoldBootstrap({
		framework: "tanstack-start",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
	});
	expect(bootstrap.map((file) => file.path)).toEqual([".oxlintrc.json", ".oxfmtrc.json"]);
	expect(commands.some((command) => command.argv.includes("apply"))).toBe(false);
	expect(commands.flatMap((command) => command.argv)).toContain(FIZZYX_ADMIN_PRESET);
	expect(commands.flatMap((command) => command.argv).join(" ")).not.toMatch(/\bnpm|\bnpx/);
});

test("allows callers to override the default shadcn preset", () => {
	const commands = planAdminScaffold({
		framework: "nextjs",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
		preset: "customPreset123",
	});
	expect(commands.flatMap((command) => command.argv)).toContain("customPreset123");
	expect(commands.flatMap((command) => command.argv)).not.toContain(FIZZYX_ADMIN_PRESET);
});

test("forwards non-structural shadcn init arguments without changing argv boundaries", () => {
	const commands = planAdminScaffold({
		framework: "nextjs",
		projectName: "pet-admin",
		targetDir: "/tmp/pet-admin",
		packageManager: "bun",
		shadcnArgs: ["--rtl", "--base", "aria", "button", "https://registry.example/item.json"],
	});

	expect(commands[0]?.argv.slice(-5)).toEqual([
		"--rtl",
		"--base",
		"aria",
		"button",
		"https://registry.example/item.json",
	]);
});

test("uses a forwarded shadcn preset as the effective recorded preset", () => {
	expect(resolveAdminPreset("configured", ["--preset", "forwarded"])).toBe("forwarded");
	expect(resolveAdminPreset(undefined, ["-pattached"])).toBe("attached");
});

test("rejects shadcn passthrough arguments that conflict with scaffold ownership", () => {
	for (const args of [
		["--template", "vite"],
		["--name=other"],
		["-c", "/elsewhere"],
		["--defaults"],
		["-y"],
	]) {
		expect(() =>
			planAdminScaffold({
				framework: "nextjs",
				projectName: "pet-admin",
				targetDir: "/tmp/pet-admin",
				packageManager: "bun",
				shadcnArgs: args,
			}),
		).toThrow(/reserved shadcn init argument/);
	}
	expect(() =>
		planAdminScaffold({
			framework: "nextjs",
			projectName: "pet-admin",
			targetDir: "/tmp/pet-admin",
			packageManager: "bun",
			shadcnArgs: ["--monorepo"],
		}),
	).toThrow(/not supported by the current admin renderer/);
});
