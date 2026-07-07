import { Effect } from "effect";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeBunConfigRepository } from "../src/adapters/bun-config-repository";
import type { PlannerRuntimeApi } from "../src/adapters/planner-runtime";
import { ConfigError, FileError } from "../src/domain/errors";
import type { ProjectConfig } from "../src/domain/models";
import { ConfigRepo, type ConfigRepository } from "../src/ports/config-repository";
import { buildPlannerContext } from "../src/use-cases/planner-service";
import { resolvePlannerServiceConfig } from "../src/use-cases/planner-runtime-context";

const baseConfig = {
	apiUrl: "https://example.com",
	account: "acme",
	board: "project-board",
	configPath: "/repo/.fizzyx.yaml",
	rootDir: "/repo",
} satisfies ProjectConfig;

const makeConfigRepo = (projectConfig?: ProjectConfig): ConfigRepository =>
	({
		loadProjectConfig: () =>
			projectConfig
				? Effect.succeed(projectConfig)
				: Effect.fail(new ConfigError({ message: "missing" })),
		loadProjectConfigOptional: () => Effect.succeed(projectConfig),
		setupProjectConfig: () =>
			Effect.fail(new FileError({ message: "not mocked", path: "/repo/.fizzyx.yaml" })),
		loadCredentials: () => Effect.succeed({ token: "token" }),
		migrateCredentialsFromOfficial: () => Effect.fail(new FileError({ message: "not mocked" })),
		saveCredentials: () => Effect.succeed(undefined),
		deleteCredentials: () => Effect.succeed(undefined),
		setupOssConfig: () =>
			Effect.fail(new FileError({ message: "not mocked", path: "/repo/.fizzyx.yaml" })),
		setupOpenApiConfig: () =>
			Effect.fail(new FileError({ message: "not mocked", path: "/repo/.fizzyx.yaml" })),
		saveProjectConfig: () =>
			Effect.fail(new FileError({ message: "not mocked", path: "/repo/.fizzyx.yaml" })),
	}) as ConfigRepository;

const makeBoardPayload = (id: string, name: string) => ({
	id,
	name,
	all_access: true,
	created_at: "2026-01-01T00:00:00.000Z",
	url: `https://example.com/boards/${id}`,
});

test("planner config uses project board as default when project config exists", async () => {
	const result = await Effect.runPromise(
		resolvePlannerServiceConfig().pipe(
			Effect.provideService(ConfigRepo, makeConfigRepo(baseConfig)),
		),
	);

	expect(result.config.board).toBe("project-board");
	expect(result.config.account).toBe("acme");
});

test("planner context supports a global board when no project config exists", async () => {
	const result = await Effect.runPromise(
		resolvePlannerServiceConfig({ boardId: "global-board" }).pipe(
			Effect.provideService(ConfigRepo, makeConfigRepo()),
		),
	);

	expect(result.config.board).toBe("global-board");
	expect(result.config.account).toBe("1");
	expect(result.config.apiUrl).toBe("https://fizzy.puffin.studio");
});

test("planner config uses default account with the live config repo outside a project", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-planner-global-"));
	const previousCwd = process.cwd();

	try {
		process.chdir(root);
		const result = await Effect.runPromise(
			resolvePlannerServiceConfig({ boardId: "global-board" }).pipe(
				Effect.provideService(ConfigRepo, makeBunConfigRepository()),
			),
		);

		expect(result.config.board).toBe("global-board");
		expect(result.config.configPath).toBe(`${root}/.fizzyx.yaml`);
	} finally {
		process.chdir(previousCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("planner context always returns boards and uses project board as the default", async () => {
	const runtime = {
		listBoards: (accountId: string) => {
			expect(accountId).toBe("acme");
			return Effect.succeed([
				makeBoardPayload("project-board", "Project Board"),
				makeBoardPayload("other-board", "Other Board"),
			]);
		},
	} as unknown as PlannerRuntimeApi;

	const result = await Effect.runPromise(buildPlannerContext(baseConfig, runtime));

	expect(result).toEqual({
		account: "acme",
		defaultBoard: "project-board",
		boards: [
			{ id: "project-board", name: "Project Board" },
			{ id: "other-board", name: "Other Board" },
		],
	});
});
