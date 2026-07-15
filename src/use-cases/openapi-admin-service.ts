import { Effect } from "effect";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { AdminGenerationError } from "../domain/errors";
import type { GeneratedFile } from "../domain/openapi-models";
import { AdminProcessRunner } from "../ports/admin-process-runner";
import { generate } from "./openapi-service";
import { planAdminApp } from "./openapi-admin-plan";
import { renderAdminApp } from "./openapi-admin-render";
import {
	planAdminScaffold,
	planAdminScaffoldBootstrap,
	type AdminScaffoldBootstrapFile,
	type AdminScaffoldCommand,
	type AdminFramework,
	type AdminPackageManager,
} from "./openapi-admin-scaffold";
import {
	refreshAdminGeneratedFileHashes,
	writeAdminGeneratedFiles,
} from "./openapi-admin-manifest";
import { configureAdminQualityScripts, planAdminQualityCommands } from "./openapi-admin-quality";

export interface GenerateAdminProjectInput {
	input: string;
	output: string;
	framework: AdminFramework;
	dryRun?: boolean;
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

const prefixed = (prefix: string, files: GeneratedFile[]): GeneratedFile[] =>
	files.map((file) => ({ ...file, path: `${prefix}/${file.path}` }));

const isBunCompatibilityFailure = (error: AdminGenerationError): boolean =>
	/(bun.*(?:unsupported|not supported|not found)|(?:unsupported|not supported).*bun)/i.test(
		`${error.message}\n${error.stderr ?? ""}`,
	);

const runScaffold = (
	commands: AdminScaffoldCommand[],
	bootstrap: AdminScaffoldBootstrapFile[],
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
	});

const runQualityCommands = (packageManager: AdminPackageManager, outputDir: string) =>
	Effect.gen(function* () {
		const runner = yield* AdminProcessRunner;
		for (const argv of planAdminQualityCommands(packageManager)) {
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
		const plan = planAdminApp(client.spec);
		let packageManager: AdminPackageManager = "bun";
		let scaffold = planAdminScaffold({
			framework: input.framework,
			projectName,
			targetDir: outputDir,
			packageManager,
		});
		let bootstrap = planAdminScaffoldBootstrap({
			framework: input.framework,
			projectName,
			targetDir: outputDir,
			packageManager,
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
		if (existsSync(outputDir) && readdirSync(outputDir).length > 0 && !manifestExists) {
			return yield* Effect.fail(
				new AdminGenerationError({ message: `output directory is not empty: ${outputDir}` }),
			);
		}

		if (!manifestExists) {
			yield* runScaffold(scaffold, bootstrap, outputDir).pipe(
				Effect.catch((error) => {
					if (!isBunCompatibilityFailure(error)) return Effect.fail(error);
					if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
					packageManager = "pnpm";
					scaffold = planAdminScaffold({
						framework: input.framework,
						projectName,
						targetDir: outputDir,
						packageManager,
					});
					bootstrap = planAdminScaffoldBootstrap({
						framework: input.framework,
						projectName,
						targetDir: outputDir,
						packageManager,
					});
					return runScaffold(scaffold, bootstrap, outputDir);
				}),
			);
		}

		const files = [
			...prefixed("src/lib/api/generated", client.files),
			...renderAdminApp(plan, input.framework),
		];
		const specFingerprint = new Bun.CryptoHasher("sha256")
			.update(JSON.stringify(client.spec))
			.digest("hex");
		const writeResult = yield* Effect.try({
			try: () =>
				writeAdminGeneratedFiles(outputDir, files, {
					framework: input.framework,
					packageManager,
					specFingerprint,
				}),
			catch: (cause) =>
				new AdminGenerationError({ message: "failed to write admin project", cause }),
		});
		if (!manifestExists) {
			yield* runQualityCommands(packageManager, outputDir);
			yield* Effect.try({
				try: () =>
					refreshAdminGeneratedFileHashes(
						outputDir,
						files.map((file) => file.path),
					),
				catch: (cause) =>
					new AdminGenerationError({
						message: "failed to refresh formatted admin manifest",
						cause,
					}),
			});
		}

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
