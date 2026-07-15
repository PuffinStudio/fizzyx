export type AdminFramework = "nextjs" | "tanstack-start";
export type AdminPackageManager = "bun" | "pnpm";

export interface AdminScaffoldInput {
	framework: AdminFramework;
	projectName: string;
	targetDir: string;
	packageManager: AdminPackageManager;
}

export interface AdminScaffoldCommand {
	argv: string[];
}

export interface AdminScaffoldBootstrapFile {
	path: string;
	content: string;
}

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
		...(input.packageManager === "bun" ? ["bunx", "--bun"] : ["pnpm", "dlx"]),
		"shadcn@latest",
		"init",
		"-d",
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
					"class-variance-authority",
					"clsx",
					"tailwind-merge",
					"--cwd",
					input.targetDir,
				]
			: [
					"pnpm",
					"add",
					"@tanstack/react-query",
					"@tanstack/react-table",
					"@tanstack/react-form",
					"class-variance-authority",
					"clsx",
					"tailwind-merge",
					"--dir",
					input.targetDir,
				],
});

const shadcnComponentsCommand = (input: AdminScaffoldInput): AdminScaffoldCommand => ({
	argv: [
		...(input.packageManager === "bun" ? ["bunx", "--bun"] : ["pnpm", "dlx"]),
		"shadcn@latest",
		"add",
		"--all",
		"-y",
		"-c",
		input.targetDir,
	],
});

export const planAdminScaffold = (input: AdminScaffoldInput): AdminScaffoldCommand[] => {
	const frameworkCommand =
		input.framework === "nextjs" ? nextCommand(input) : tanstackStartCommand(input);
	return input.framework === "nextjs"
		? [
				frameworkCommand,
				shadcnCommand(input),
				queryDependencyCommand(input),
				shadcnComponentsCommand(input),
			]
		: [frameworkCommand, queryDependencyCommand(input), shadcnComponentsCommand(input)];
};

const tanstackComponentsConfig = `${JSON.stringify(
	{
		$schema: "https://ui.shadcn.com/schema.json",
		style: "new-york",
		rsc: false,
		tsx: true,
		tailwind: {
			config: "",
			css: "src/styles.css",
			baseColor: "neutral",
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
			]
		: [];
