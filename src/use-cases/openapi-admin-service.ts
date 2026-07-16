import { Effect } from "effect";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { AdminGenerationError } from "../domain/errors";
import type { GeneratedFile } from "../domain/openapi-models";
import type { ParsedAdminAuthConfig } from "../domain/openapi-models";
import type { AdminPresentationDefaults } from "../domain/openapi-models";
import { AdminProcessRunner } from "../ports/admin-process-runner";
import { generate } from "./openapi-service";
import { planAdminApp } from "./openapi-admin-plan";
import { renderAdminApp } from "./openapi-admin-render";
import {
	planAdminScaffold,
	planAdminScaffoldBootstrap,
	planAdminScaffoldFinalize,
	FIZZYX_ADMIN_PRESET,
	type AdminScaffoldBootstrapFile,
	type AdminScaffoldCommand,
	type AdminFramework,
	type AdminPackageManager,
} from "./openapi-admin-scaffold";
import {
	readAdminManifestMetadata,
	refreshAdminGeneratedFileHashes,
	writeAdminGeneratedFiles,
} from "./openapi-admin-manifest";
import {
	configureAdminQualityScripts,
	planAdminQualityCommands,
	planAdminTargetedQualityCommands,
} from "./openapi-admin-quality";

export interface GenerateAdminProjectInput {
	input: string;
	output: string;
	framework: AdminFramework;
	dryRun?: boolean;
	auth?: ParsedAdminAuthConfig;
	preset?: string;
	createMode?: "page" | "dialog";
	presentation?: Partial<AdminPresentationDefaults>;
}

export interface GenerateAdminProjectResult {
	outputDir: string;
	framework: AdminFramework;
	packageManager: AdminPackageManager;
	resources: number;
	diagnostics: string[];
	commands: string[][];
	written: string[];
	conflicts: string[];
}

export interface AdminSyncCandidate {
	specFingerprint: string;
	plan: ReturnType<typeof planAdminApp>;
	files: GeneratedFile[];
}

const prefixed = (prefix: string, files: GeneratedFile[]): GeneratedFile[] =>
	files.map((file) => ({ ...file, path: `${prefix}/${file.path}` }));

/** Builds the complete generated state without touching the target project. */
export const prepareAdminSyncCandidate = (
	input: Pick<
		GenerateAdminProjectInput,
		"input" | "framework" | "auth" | "createMode" | "presentation"
	>,
): Effect.Effect<AdminSyncCandidate, any, any> =>
	Effect.gen(function* () {
		const client = yield* generate({
			input: input.input,
			output: "src/lib/api/generated",
			client: "fetch",
			stateManagement: "tanstack-query",
		});
		const spec =
			client.spec.admin?.auth || !input.auth
				? client.spec
				: { ...client.spec, admin: { ...client.spec.admin, auth: input.auth } };
		const plan = planAdminApp(spec, { presentation: input.presentation });
		return {
			specFingerprint: new Bun.CryptoHasher("sha256").update(JSON.stringify(spec)).digest("hex"),
			plan,
			files: [
				...prefixed("src/lib/api/generated", client.files),
				...renderAdminApp(plan, input.framework, { createMode: input.createMode }),
			],
		};
	});

const isBunCompatibilityFailure = (error: AdminGenerationError): boolean =>
	/(bun.*(?:unsupported|not supported|not found)|(?:unsupported|not supported).*bun)/i.test(
		`${error.message}\n${error.stderr ?? ""}`,
	);

const runScaffold = (
	commands: AdminScaffoldCommand[],
	bootstrap: AdminScaffoldBootstrapFile[],
	finalize: AdminScaffoldBootstrapFile[],
	outputDir: string,
) =>
	Effect.gen(function* () {
		const runner = yield* AdminProcessRunner;
		const [frameworkCommand, ...remaining] = commands;
		if (!frameworkCommand) return;
		yield* runner.run(frameworkCommand.argv);
		yield* Effect.try({
			try: () => {
				for (const file of bootstrap) {
					const destination = join(outputDir, file.path);
					mkdirSync(dirname(destination), { recursive: true });
					writeFileSync(destination, file.content);
				}
				configureAdminQualityScripts(outputDir);
			},
			catch: (cause) =>
				new AdminGenerationError({ message: "failed to bootstrap shadcn config", cause }),
		});
		for (const command of remaining) yield* runner.run(command.argv);
		yield* Effect.try({
			try: () => {
				for (const file of finalize) {
					const destination = join(outputDir, file.path);
					mkdirSync(dirname(destination), { recursive: true });
					writeFileSync(destination, file.content);
				}
			},
			catch: (cause) =>
				new AdminGenerationError({ message: "failed to finalize admin scaffold", cause }),
		});
	});

const runQualityCommands = (packageManager: AdminPackageManager, outputDir: string) =>
	Effect.gen(function* () {
		const runner = yield* AdminProcessRunner;
		for (const argv of planAdminQualityCommands(packageManager)) {
			yield* runner.run(argv, outputDir);
		}
	});

const runTargetedQualityCommands = (
	packageManager: AdminPackageManager,
	outputDir: string,
	paths: string[],
) =>
	Effect.gen(function* () {
		const runner = yield* AdminProcessRunner;
		for (const argv of planAdminTargetedQualityCommands(packageManager, paths)) {
			yield* runner.run(argv, outputDir);
		}
	});

const validateProjectName = (name: string): void => {
	if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
		throw new AdminGenerationError({
			message: "output directory name must use lowercase letters, numbers, and hyphens",
		});
	}
};

const prepareDashboardRoute = (
	outputDir: string,
	framework: AdminFramework,
	freshScaffold: boolean,
): void => {
	const relative = framework === "nextjs" ? "src/app/page.tsx" : "src/routes/index.tsx";
	const path = join(outputDir, relative);
	if (!existsSync(path)) return;
	const content = readFileSync(path, "utf8");
	if (
		freshScaffold ||
		content.includes("Welcome to TanStack Start") ||
		content.includes("create-next-app") ||
		(content.includes("Get started by editing") && content.includes("next.svg"))
	) {
		unlinkSync(path);
		return;
	}
	if (content.startsWith("// Generated by fizzyx.")) return;
	throw new AdminGenerationError({
		message: `custom root route conflicts with the generated dashboard: ${relative}; move or remove it, then regenerate`,
	});
};

export const generateAdminProject = (input: GenerateAdminProjectInput) =>
	Effect.gen(function* () {
		const outputDir = resolve(input.output);
		const projectName = basename(outputDir);
		yield* Effect.try({
			try: () => validateProjectName(projectName),
			catch: (cause) =>
				cause instanceof AdminGenerationError
					? cause
					: new AdminGenerationError({ message: String(cause), cause }),
		});

		const client = yield* generate({
			input: input.input,
			output: `${outputDir}/src/lib/api/generated`,
			client: "fetch",
			stateManagement: "tanstack-query",
		});
		const spec =
			client.spec.admin?.auth || !input.auth
				? client.spec
				: { ...client.spec, admin: { ...client.spec.admin, auth: input.auth } };
		const plan = planAdminApp(spec, { presentation: input.presentation });
		const manifestMetadata = readAdminManifestMetadata(outputDir);
		let packageManager: AdminPackageManager = manifestMetadata?.packageManager ?? "bun";
		const preset = input.preset ?? manifestMetadata?.preset ?? FIZZYX_ADMIN_PRESET;
		const createMode = input.createMode ?? manifestMetadata?.createMode;
		let scaffold = planAdminScaffold({
			framework: input.framework,
			projectName,
			targetDir: outputDir,
			packageManager,
			preset,
		});
		let bootstrap = planAdminScaffoldBootstrap({
			framework: input.framework,
			projectName,
			targetDir: outputDir,
			packageManager,
			preset,
		});
		let finalize = planAdminScaffoldFinalize({
			framework: input.framework,
			projectName,
			targetDir: outputDir,
			packageManager,
			preset,
		});
		const commands = scaffold.map((command) => command.argv);

		if (input.dryRun) {
			return {
				outputDir,
				framework: input.framework,
				packageManager: packageManager as AdminPackageManager,
				resources: plan.resources.length,
				diagnostics: plan.diagnostics.map((item) => item.message),
				commands,
				written: [],
				conflicts: [],
			} satisfies GenerateAdminProjectResult;
		}

		const manifestExists = existsSync(`${outputDir}/.fizzyx/admin-manifest.json`);
		if (manifestExists && input.preset && input.preset !== manifestMetadata?.preset) {
			return yield* Effect.fail(
				new AdminGenerationError({
					message:
						"cannot safely replace the shadcn preset during regeneration because component files may be user-owned; generate a new output or apply the preset manually after reviewing the shadcn diff",
				}),
			);
		}
		if (existsSync(outputDir) && readdirSync(outputDir).length > 0 && !manifestExists) {
			return yield* Effect.fail(
				new AdminGenerationError({ message: `output directory is not empty: ${outputDir}` }),
			);
		}

		if (!manifestExists) {
			yield* runScaffold(scaffold, bootstrap, finalize, outputDir).pipe(
				Effect.catch((error) => {
					if (!isBunCompatibilityFailure(error)) return Effect.fail(error);
					if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
					packageManager = "pnpm";
					scaffold = planAdminScaffold({
						framework: input.framework,
						projectName,
						targetDir: outputDir,
						packageManager,
						preset,
					});
					bootstrap = planAdminScaffoldBootstrap({
						framework: input.framework,
						projectName,
						targetDir: outputDir,
						packageManager,
						preset,
					});
					finalize = planAdminScaffoldFinalize({
						framework: input.framework,
						projectName,
						targetDir: outputDir,
						packageManager,
						preset,
					});
					return runScaffold(scaffold, bootstrap, finalize, outputDir);
				}),
			);
		}
		yield* Effect.try({
			try: () => prepareDashboardRoute(outputDir, input.framework, !manifestExists),
			catch: (cause) =>
				cause instanceof AdminGenerationError
					? cause
					: new AdminGenerationError({
							message: "failed to prepare the generated dashboard route",
							cause,
						}),
		});

		const files = [
			...prefixed("src/lib/api/generated", client.files),
			...renderAdminApp(plan, input.framework, { createMode }),
		];
		const specFingerprint = new Bun.CryptoHasher("sha256")
			.update(JSON.stringify(spec))
			.digest("hex");
		const writeResult = yield* Effect.try({
			try: () =>
				writeAdminGeneratedFiles(outputDir, files, {
					framework: input.framework,
					packageManager,
					specFingerprint,
					specSource: input.input,
					preset,
					createMode,
					adminPlanSnapshot: plan,
				}),
			catch: (cause) =>
				new AdminGenerationError({ message: "failed to write admin project", cause }),
		});
		if (manifestExists) {
			yield* runTargetedQualityCommands(packageManager, outputDir, writeResult.written);
		} else {
			yield* runQualityCommands(packageManager, outputDir);
		}
		yield* Effect.try({
			try: () => refreshAdminGeneratedFileHashes(outputDir, writeResult.written),
			catch: (cause) =>
				new AdminGenerationError({
					message: "failed to refresh formatted admin manifest",
					cause,
				}),
		});

		return {
			outputDir,
			framework: input.framework,
			packageManager: packageManager as AdminPackageManager,
			resources: plan.resources.length,
			diagnostics: plan.diagnostics.map((item) => item.message),
			commands: scaffold.map((command) => command.argv),
			written: writeResult.written,
			conflicts: writeResult.conflicts,
		} satisfies GenerateAdminProjectResult;
	});
