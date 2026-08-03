import { adminQualityBootstrapFiles } from "./openapi-admin-quality";
import autoformSelectFieldTemplate from "../templates/openapi-admin/shared/autoform-select-field.tsx.txt" with { type: "text" };
import { dirname } from "node:path";

export type AdminFramework = "nextjs" | "tanstack-start";
export type AdminPackageManager = "bun" | "pnpm";

export interface AdminScaffoldInput {
	framework: AdminFramework;
	projectName: string;
	targetDir: string;
	packageManager: AdminPackageManager;
	preset?: string;
	shadcnArgs?: readonly string[];
}

export interface AdminScaffoldCommand {
	argv: string[];
}

export interface AdminScaffoldBootstrapFile {
	path: string;
	content: string;
}

// Base UI + Mira, Mist, Indigo, Cyan charts, Inter, medium radius, inverted menu.
// Inspect with: bunx --bun shadcn@latest preset decode b1tNoIJIf
export const FIZZYX_ADMIN_PRESET = "b1tNoIJIf";
export const AUTOFORM_TANSTACK_REGISTRY =
	"https://raw.githubusercontent.com/vantezzen/autoform/refs/heads/main/packages/shadcn/registry/autoform-tanstack.json";

const shadcnRunner = (packageManager: AdminPackageManager): string[] =>
	packageManager === "bun" ? ["bunx", "--bun"] : ["pnpm", "dlx"];

const RESERVED_SHADCN_ARGS = new Set([
	"--template",
	"-t",
	"--name",
	"-n",
	"--cwd",
	"-c",
	"--yes",
	"-y",
	"--defaults",
	"-d",
]);

const INCOMPATIBLE_SHADCN_ARGS = new Set(["--monorepo"]);

const optionName = (argument: string): string => argument.split("=", 1)[0] ?? argument;

const validatesShadcnArgs = (args: readonly string[]): void => {
	for (const argument of args) {
		const name = optionName(argument);
		const attachedShort = /^-([tcnyd])[^-]/.exec(name)?.[1];
		if (RESERVED_SHADCN_ARGS.has(name) || attachedShort) {
			throw new Error(`reserved shadcn init argument cannot be forwarded: ${argument}`);
		}
		if (INCOMPATIBLE_SHADCN_ARGS.has(name)) {
			throw new Error(
				`shadcn init argument is not supported by the current admin renderer: ${argument}`,
			);
		}
	}
};

const optionValue = (args: readonly string[], names: readonly string[]): string | undefined => {
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] ?? "";
		const name = optionName(argument);
		if (!names.includes(name)) {
			const short = names.find((candidate) => candidate.length === 2 && name.startsWith(candidate));
			if (short) return name.slice(short.length);
			continue;
		}
		if (argument.includes("=")) return argument.slice(argument.indexOf("=") + 1);
		const value = args[index + 1];
		if (!value || value.startsWith("-")) throw new Error(`${argument} requires a value`);
		return value;
	}
	return undefined;
};

export const resolveAdminPreset = (
	requested: string | undefined,
	shadcnArgs: readonly string[] = [],
): string => optionValue(shadcnArgs, ["--preset", "-p"]) ?? requested ?? FIZZYX_ADMIN_PRESET;

const hasOption = (args: readonly string[], names: readonly string[]): boolean =>
	args.some((argument) => {
		const name = optionName(argument);
		return (
			names.includes(name) ||
			names.some((candidate) => candidate.length === 2 && name.startsWith(candidate))
		);
	});

const shadcnInitCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => {
	const shadcnArgs = input.shadcnArgs ?? [];
	validatesShadcnArgs(shadcnArgs);
	const preset = resolveAdminPreset(input.preset, shadcnArgs);
	return {
		argv: [
			...shadcnRunner(input.packageManager),
			"shadcn@latest",
			"init",
			"--template",
			input.framework === "nextjs" ? "next" : "start",
			"--name",
			input.projectName,
			...(hasOption(shadcnArgs, ["--base", "-b"]) ? [] : ["--base", "base"]),
			...(hasOption(shadcnArgs, ["--preset", "-p"]) ? [] : ["--preset", preset]),
			"--yes",
			"--cwd",
			dirname(input.targetDir),
			...shadcnArgs,
		],
	};
};

const queryDependencyCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv:
		input.packageManager === "bun"
			? [
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
					input.targetDir,
				]
			: [
					"pnpm",
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
					"--dir",
					input.targetDir,
				],
});

const shadcnComponentsCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...shadcnRunner(input.packageManager),
		"shadcn@latest",
		"add",
		"--all",
		"--overwrite",
		"-y",
		"-c",
		input.targetDir,
	],
});

const autoformCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...shadcnRunner(input.packageManager),
		"shadcn@latest",
		"add",
		AUTOFORM_TANSTACK_REGISTRY,
		"-y",
		"-c",
		input.targetDir,
	],
});

const qualityDependencyCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv:
		input.packageManager === "bun"
			? ["bun", "add", "--dev", "oxlint", "oxfmt", "--cwd", input.targetDir]
			: ["pnpm", "add", "--save-dev", "oxlint", "oxfmt", "--dir", input.targetDir],
});

export const planAdminScaffold = (input: AdminScaffoldInput): AdminScaffoldCommand[] => {
	return [
		shadcnInitCommand(input),
		queryDependencyCommand(input),
		qualityDependencyCommand(input),
		autoformCommand(input),
		shadcnComponentsCommand(input),
	];
};

export const planAdminScaffoldBootstrap = (
	input: AdminScaffoldInput,
): AdminScaffoldBootstrapFile[] => adminQualityBootstrapFiles(input.framework);

export const planAdminScaffoldFinalize = (
	_input: AdminScaffoldInput,
): AdminScaffoldBootstrapFile[] => [
	{
		path: "src/components/ui/autoform/components/tanstack/SelectField.tsx",
		content: autoformSelectFieldTemplate,
	},
];
