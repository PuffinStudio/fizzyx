import { adminQualityBootstrapFiles } from "./openapi-admin-quality";
import autoformSelectFieldTemplate from "../templates/openapi-admin/shared/autoform-select-field.tsx.txt" with { type: "text" };

export type AdminFramework = "nextjs" | "tanstack-start";
export type AdminPackageManager = "bun" | "pnpm";

export interface AdminScaffoldInput {
	framework: AdminFramework;
	projectName: string;
	targetDir: string;
	packageManager: AdminPackageManager;
	preset?: string;
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

const nextCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv:
		input.packageManager === "bun"
			? [
					"bun",
					"create",
					"next-app@latest",
					input.targetDir,
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
				]
			: [
					"pnpm",
					"create",
					"next-app@latest",
					input.targetDir,
					"--ts",
					"--tailwind",
					"--eslint",
					"--app",
					"--src-dir",
					"--import-alias",
					"@/*",
					"--use-pnpm",
					"--yes",
					"--disable-git",
				],
});

const shadcnCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...shadcnRunner(input.packageManager),
		"shadcn@latest",
		"init",
		"--base",
		"base",
		"--preset",
		input.preset ?? FIZZYX_ADMIN_PRESET,
		"-y",
		"-c",
		input.targetDir,
	],
});

const shadcnApplyPresetCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...shadcnRunner(input.packageManager),
		"shadcn@latest",
		"apply",
		"--preset",
		input.preset ?? FIZZYX_ADMIN_PRESET,
		"-y",
		"-c",
		input.targetDir,
	],
});

const tanstackStartCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...(input.packageManager === "bun" ? ["bunx"] : ["pnpm", "dlx"]),
		"@tanstack/cli@latest",
		"create",
		input.projectName,
		"--package-manager",
		input.packageManager,
		"--framework",
		"React",
		"--add-ons",
		"tanstack-query",
		"--no-examples",
		"--no-git",
		"--target-dir",
		input.targetDir,
		"-y",
	],
});

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
	const frameworkCommand =
		input.framework === "nextjs" ? nextCommand(input) : tanstackStartCommand(input);
	return input.framework === "nextjs"
		? [
				frameworkCommand,
				shadcnCommand(input),
				queryDependencyCommand(input),
				qualityDependencyCommand(input),
				autoformCommand(input),
				shadcnComponentsCommand(input),
			]
		: [
				frameworkCommand,
				queryDependencyCommand(input),
				qualityDependencyCommand(input),
				shadcnApplyPresetCommand(input),
				autoformCommand(input),
				shadcnComponentsCommand(input),
			];
};

const tanstackComponentsConfig = `${JSON.stringify(
	{
		$schema: "https://ui.shadcn.com/schema.json",
		style: "base-mira",
		rsc: false,
		tsx: true,
		tailwind: {
			config: "",
			css: "src/styles.css",
			baseColor: "mist",
			cssVariables: true,
			prefix: "",
		},
		iconLibrary: "lucide",
		aliases: {
			components: "@/components",
			utils: "@/lib/utils",
			ui: "@/components/ui",
			lib: "@/lib",
			hooks: "@/hooks",
		},
		registries: {},
	},
	null,
	2,
)}\n`;

const tanstackUtils = `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`;

export const planAdminScaffoldBootstrap = (
	input: AdminScaffoldInput,
): AdminScaffoldBootstrapFile[] =>
	input.framework === "tanstack-start"
		? [
				{ path: "components.json", content: tanstackComponentsConfig },
				{ path: "src/lib/utils.ts", content: tanstackUtils },
				...adminQualityBootstrapFiles(input.framework),
			]
		: adminQualityBootstrapFiles(input.framework);

export const planAdminScaffoldFinalize = (
	_input: AdminScaffoldInput,
): AdminScaffoldBootstrapFile[] => [
	{
		path: "src/components/ui/autoform/components/tanstack/SelectField.tsx",
		content: autoformSelectFieldTemplate,
	},
];
