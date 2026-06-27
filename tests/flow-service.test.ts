import { Effect } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { BoardCache } from "../src/domain/models";
import { ApiError, ConfigError, FileError, ValidationError } from "../src/domain/errors";
import type { ConfigRepository } from "../src/ports/config-repository";
import type { FizzyApi } from "../src/ports/fizzy-api";
import {
	add,
	assign,
	next,
	nextOrStart,
	mine,
	completeSteps,
	buildStandardizedCommentBody,
	convertDescription,
	getStandardizedCommentTemplate,
	done,
	start,
	resolveDoneRefFromGit,
	block,
	standardizeBoard,
	standardizeCard,
	stepsFromDescription,
} from "../src/use-cases/flow-service";

const baseConfig = {
	apiUrl: "https://example.com",
	account: "1",
	board: "board-1",
	configPath: "/tmp/.fizzy.yaml",
	rootDir: "/tmp",
	flow: {
		columns: {
			todo: "todo-id",
			inProgress: "inprogress-id",
		},
		users: {},
		wipLimit: 2,
		cacheTtlSeconds: 900,
	},
} as const;

const makeCacheRepo = () => ({
	read: () => Effect.succeed(null),
	write: () => Effect.succeed(undefined),
	ageSeconds: () => Effect.succeed(1000),
});

const makeConfigRepo = (): ConfigRepository =>
	({
		loadProjectConfig: () => Effect.fail(new ConfigError({ message: "config repo not mocked" })),
		loadProjectConfigOptional: () =>
			Effect.fail(new ConfigError({ message: "config repo not mocked" })),
		setupProjectConfig: () =>
			Effect.fail(new FileError({ message: "config repo not mocked", path: "/tmp/.fizzy.yaml" })),
		loadCredentials: () =>
			Effect.fail(new FileError({ message: "config repo not mocked", path: "/tmp/.fizzy.yaml" })),
		migrateCredentialsFromOfficial: () =>
			Effect.fail(new FileError({ message: "config repo not mocked" })),
		saveCredentials: () => Effect.succeed(undefined),
		deleteCredentials: () => Effect.succeed(undefined),
		setupOssConfig: () =>
			Effect.fail(new FileError({ message: "config repo not mocked", path: "/tmp/.fizzy.yaml" })),
		setupOpenApiConfig: () =>
			Effect.fail(new FileError({ message: "config repo not mocked", path: "/tmp/.fizzy.yaml" })),
	}) as ConfigRepository;

const defaultApi = () =>
	({
		identity: () => Effect.fail(new ApiError({ message: "identity not mocked" })),
		listColumns: () => Effect.succeed([]),
		listBoards: () => Effect.fail(new ApiError({ message: "listBoards not mocked" })),
		listCards: () => Effect.fail(new ApiError({ message: "listCards not mocked" })),
		showCard: () => Effect.fail(new ApiError({ message: "showCard not mocked" })),
		listComments: () => Effect.fail(new ApiError({ message: "listComments not mocked" })),
		createColumn: () => Effect.fail(new ApiError({ message: "createColumn not mocked" })),
		createCard: () => Effect.fail(new ApiError({ message: "createCard not mocked" })),
		assignCard: () => Effect.fail(new ApiError({ message: "assignCard not mocked" })),
		tagCard: () => Effect.fail(new ApiError({ message: "tagCard not mocked" })),
		moveCard: () => Effect.fail(new ApiError({ message: "moveCard not mocked" })),
		triageCard: () => Effect.fail(new ApiError({ message: "triageCard not mocked" })),
		untriageCard: () => Effect.fail(new ApiError({ message: "untriageCard not mocked" })),
		comment: () => Effect.fail(new ApiError({ message: "comment not mocked" })),
		closeCard: () => Effect.fail(new ApiError({ message: "closeCard not mocked" })),
		postponeCard: () => Effect.fail(new ApiError({ message: "postponeCard not mocked" })),
		updateCardDescription: () =>
			Effect.fail(new ApiError({ message: "updateCardDescription not mocked" })),
		updateStep: () => Effect.fail(new ApiError({ message: "updateStep not mocked" })),
		createStep: () => Effect.fail(new ApiError({ message: "createStep not mocked" })),
	}) as unknown as FizzyApi;

const makeEnv = (api: FizzyApi) => ({
	config: baseConfig,
	configRepo: makeConfigRepo(),
	cacheRepo: makeCacheRepo(),
	api,
});

const makeCacheRepoFrom = (cache: BoardCache, age = 0) => ({
	read: () => Effect.succeed(cache),
	write: () => Effect.succeed(undefined),
	ageSeconds: () => Effect.succeed(age),
});

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fizzyx-cli-"));

const runGit = (cwd: string, args: ReadonlyArray<string>): void => {
	const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore" });
	if (proc.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed`);
	}
};

test("resolveDoneRefFromGit requires git metadata", async () => {
	const dir = makeTempDir();

	try {
		let error: unknown;

		try {
			await Effect.runPromise(resolveDoneRefFromGit({ cwd: dir }));
			error = undefined;
		} catch (cause) {
			error = cause;
		}

		expect(error).toBeInstanceOf(ValidationError);
		if (error instanceof ValidationError) {
			expect(String(error.message)).toContain("Pass an explicit ref");
		}
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
});

test("resolveDoneRefFromGit rejects dirty worktrees", async () => {
	const dir = makeTempDir();

	try {
		runGit(dir, ["init"]);
		writeFileSync(join(dir, "file.txt"), "initial\n");
		runGit(dir, ["add", "file.txt"]);
		runGit(dir, [
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-m",
			"initial",
		]);
		writeFileSync(join(dir, "file.txt"), "changed\n");

		let error: unknown;
		try {
			await Effect.runPromise(resolveDoneRefFromGit({ cwd: dir }));
			error = undefined;
		} catch (cause) {
			error = cause;
		}

		expect(error).toBeInstanceOf(ValidationError);
		if (error instanceof ValidationError) {
			expect(error.message).toContain("uncommitted changes");
		}
	} finally {
		rmSync(dir, { force: true, recursive: true });
	}
});

test("done blocks closing cards with unfinished steps", async () => {
	const calls: string[] = [];
	const api = defaultApi();
	api.showCard = () => {
		calls.push("showCard");
		return Effect.succeed({
			number: 7,
			title: "Finish feature",
			steps: [
				{ id: "s1", content: "Write implementation", completed: true },
				{ id: "s2", content: "Update docs", completed: false },
			],
		});
	};

	const env = makeEnv(api);
	let error: unknown;

	try {
		await Effect.runPromise(done(env, 7));
		throw new Error("done should fail when steps remain");
	} catch (cause) {
		error = cause;
	}

	expect(error).toBeInstanceOf(ValidationError);
	if (error instanceof ValidationError) {
		expect(error.message).toContain("unfinished steps remain");
		expect(error.message).toContain("- Update docs");
	}

	expect(calls).toEqual(["showCard"]);
});

test("start moves to IN PROGRESS instead of READY", async () => {
	const moveCalls: Array<{ number: number; columnId: string }> = [];
	const assignCalls: string[] = [];
	const listColumnsCalls: string[] = [];
	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity User" });
	api.listColumns = () => {
		listColumnsCalls.push("listColumns");
		return Effect.succeed([
			{ id: "backlog-id", name: "BACKLOG" },
			{ id: "ready-id", name: "READY" },
			{ id: "inprogress-id", name: "IN PROGRESS" },
			{ id: "review-id", name: "REVIEW" },
		]);
	};
	api.listCards = (options) => {
		if (options?.indexedBy === "not_now") {
			return Effect.succeed([]);
		}

		if (options?.all) {
			return Effect.succeed([
				{
					number: 5,
					title: "Card in backlog",
					column: { id: "backlog-id", name: "BACKLOG" },
					assignees: [],
				},
				{
					number: 6,
					title: "Ready card",
					column: { id: "ready-id", name: "READY" },
					assignees: [{ id: "identity-id", name: "Identity User" }],
				},
			]);
		}

		return Effect.succeed([]);
	};
	api.moveCard = (number, columnId) => {
		moveCalls.push({ number, columnId });
		return Effect.succeed(undefined);
	};
	api.showCard = () =>
		Effect.succeed({
			number: 5,
			title: "Card in backlog",
			column: { id: "inprogress-id", name: "IN PROGRESS" },
		});
	api.assignCard = (_number, userId) => {
		assignCalls.push(userId);
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(start(makeEnv(api), 5));

	expect(result).toBe(5);
	expect(listColumnsCalls).toEqual(["listColumns", "listColumns"]);
	expect(moveCalls).toEqual([{ number: 5, columnId: "inprogress-id" }]);
	expect(assignCalls).toEqual(["identity-id"]);
});

test("start ignores READY/REVIEW cards when enforcing WIP limit", async () => {
	const moveCalls: Array<{ number: number; columnId: string }> = [];
	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id" });
	api.listColumns = () =>
		Effect.succeed([
			{ id: "backlog-id", name: "BACKLOG" },
			{ id: "ready-id", name: "READY" },
			{ id: "review-id", name: "REVIEW" },
			{ id: "inprogress-id", name: "IN PROGRESS" },
		]);
	api.listCards = (options) => {
		if (options?.indexedBy === "not_now") {
			return Effect.succeed([]);
		}

		return Effect.succeed([
			{ number: 5, title: "Target", column: { id: "backlog-id", name: "BACKLOG" }, assignees: [] },
			{
				number: 6,
				title: "In-progress card",
				column: { id: "inprogress-id", name: "IN PROGRESS" },
				assignees: [{ id: "identity-id", name: "identity-id" }],
			},
			{
				number: 7,
				title: "Ready card",
				column: { id: "ready-id", name: "READY" },
				assignees: [{ id: "identity-id", name: "identity-id" }],
			},
			{
				number: 8,
				title: "Review card",
				column: { id: "review-id", name: "REVIEW" },
				assignees: [{ id: "identity-id", name: "identity-id" }],
			},
		]);
	};
	api.moveCard = (number, columnId) => {
		moveCalls.push({ number, columnId });
		return Effect.succeed(undefined);
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				wipLimit: 1,
			},
		},
	};

	let error: unknown;
	try {
		await Effect.runPromise(start(env, 5));
		error = undefined;
	} catch (cause) {
		error = cause;
	}

	expect(error).toBeInstanceOf(ValidationError);
	if (error instanceof ValidationError) {
		expect(error.message).toContain("Current user already has 1 INPROGRESS cards");
	}
	expect(moveCalls).toEqual([]);
});

test("mine ignores assigned cards outside workflow columns", async () => {
	const api = defaultApi();
	const cache: BoardCache = {
		identity: { userId: "identity-id", name: "Identity User" },
		cards: [
			{
				number: 76,
				title: "Workflow card",
				column: { id: "todo-id", name: "TODO" },
				assignees: [{ id: "identity-id", name: "me" }],
			},
			{
				number: 77,
				title: "Outside workflow",
				assignees: [{ id: "identity-id", name: "me" }],
			},
		],
		notNow: [],
		columns: [{ id: "todo-id", name: "TODO" }],
		users: { me: "identity-id" },
		syncedAt: "2026-01-01T00:00:00.000Z",
	};
	const env = {
		...makeEnv(api),
		cacheRepo: makeCacheRepoFrom(cache, 0),
	};

	const result = await Effect.runPromise(mine(env, { fresh: false }));

	expect(result.cards.map((card) => card.number)).toEqual([76]);
});

test("next prefers READY cards over BACKLOG/legacy backlog", async () => {
	const api = defaultApi();
	const cache: BoardCache = {
		identity: { userId: "identity-id", name: "Identity User" },
		cards: [
			{
				number: 77,
				title: "Backlog card",
				column: { id: "backlog-id", name: "BACKLOG" },
				assignees: [{ id: "identity-id", name: "me" }],
			},
			{
				number: 78,
				title: "Ready card",
				column: { id: "ready-id", name: "READY" },
				assignees: [{ id: "identity-id", name: "me" }],
			},
		],
		notNow: [],
		columns: [
			{ id: "backlog-id", name: "BACKLOG" },
			{ id: "ready-id", name: "READY" },
			{ id: "inprogress-id", name: "IN PROGRESS" },
		],
		users: { me: "identity-id" },
		syncedAt: "2026-01-01T00:00:00.000Z",
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				columns: {
					...baseConfig.flow.columns,
					todo: "missing-todo-id",
				},
			},
		},
		cacheRepo: makeCacheRepoFrom(cache, 0),
	};

	const result = await Effect.runPromise(next(env, { fresh: false }));

	expect(result.card?.number).toBe(78);
	expect(result.user.name).toBe("me");
});

test("next falls back to BACKLOG/legacy TODO when READY is missing", async () => {
	const api = defaultApi();
	const cache: BoardCache = {
		identity: { userId: "identity-id", name: "Identity User" },
		cards: [
			{
				number: 77,
				title: "Legacy backlog card",
				column: { id: "todo-id", name: "TODO" },
				assignees: [{ id: "identity-id", name: "me" }],
			},
		],
		notNow: [],
		columns: [{ id: "todo-id", name: "TODO" }],
		users: { me: "identity-id" },
		syncedAt: "2026-01-01T00:00:00.000Z",
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				columns: {
					...baseConfig.flow.columns,
					todo: "missing-todo-id",
				},
			},
		},
		cacheRepo: makeCacheRepoFrom(cache, 0),
	};

	const result = await Effect.runPromise(next(env, { fresh: false }));

	expect(result.card?.number).toBe(77);
	expect(result.user.name).toBe("me");
});

test("nextOrStart returns refreshed card detail after starting", async () => {
	const api = defaultApi();
	const columns = [
		{ id: "backlog-id", name: "BACKLOG" },
		{ id: "inprogress-id", name: "IN PROGRESS" },
	];
	const startedCard = {
		number: 77,
		title: "Ready to execute",
		descriptionHtml: "<p>Do this next</p>",
		column: { id: "inprogress-id", name: "IN PROGRESS" },
		assignees: [{ id: "identity-id", name: "me" }],
		steps: [{ id: "step-1", content: "Implement it", completed: false }],
	};
	const cache: BoardCache = {
		identity: { userId: "identity-id", name: "Identity User" },
		cards: [
			{
				number: 77,
				title: "Ready to execute",
				column: { id: "backlog-id", name: "BACKLOG" },
				assignees: [{ id: "identity-id", name: "me" }],
			},
		],
		notNow: [],
		columns,
		users: { me: "identity-id" },
		syncedAt: "2026-01-01T00:00:00.000Z",
	};
	const moveCalls: Array<{ number: number; columnId: string }> = [];
	let showCalls = 0;

	api.identity = () => Effect.succeed(cache.identity);
	api.listColumns = () => Effect.succeed(columns);
	api.listCards = () => Effect.succeed([startedCard]);
	api.moveCard = (number, columnId) => {
		moveCalls.push({ number, columnId });
		return Effect.succeed(undefined);
	};
	api.showCard = () => {
		showCalls += 1;
		return Effect.succeed(startedCard);
	};

	const env = {
		...makeEnv(api),
		cacheRepo: makeCacheRepoFrom(cache, 0),
	};

	const result = await Effect.runPromise(nextOrStart(env, { fresh: false, autoStart: true }));

	expect(result.started).toBe(true);
	expect(result.card).toEqual(startedCard);
	expect(moveCalls).toEqual([{ number: 77, columnId: "inprogress-id" }]);
	expect(showCalls).toBe(2);
});

test("completeSteps fails when pending steps are missing ids", async () => {
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 8,
			title: "Finish docs",
			steps: [
				{ id: "s1", content: "Write docs", completed: false },
				{ content: "Review", completed: false },
			],
		});

	const env = makeEnv(api);
	let error: unknown;

	try {
		await Effect.runPromise(completeSteps(env, 8));
		error = undefined;
	} catch (cause) {
		error = cause;
	}

	expect(error).toBeInstanceOf(ValidationError);
	if (error instanceof ValidationError) {
		expect(error.message).toContain("missing step id");
	}
});

test("completeSteps marks pending steps complete", async () => {
	const updated: string[] = [];
	const sync: string[] = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 9,
			title: "Ship task",
			steps: [
				{ id: "step-1", content: "Plan", completed: true },
				{ id: "step-2", content: "Implement", completed: false },
			],
		});
	api.updateStep = (number, stepId) => {
		updated.push(`${number}:${stepId}`);
		return Effect.succeed(undefined);
	};
	api.identity = () => Effect.succeed({ userId: "me" });
	api.listCards = (options) => {
		sync.push(JSON.stringify(options || {}));
		return Effect.succeed([]);
	};

	const result = await Effect.runPromise(completeSteps(makeEnv(api), 9));

	expect(updated).toEqual(["9:step-2"]);
	expect(sync).toEqual(['{"all":true}', '{"indexedBy":"not_now","all":true}']);
	expect(result.number).toBe(9);
	expect(result.updatedCount).toBe(1);
	expect(result.contents).toEqual(["Implement"]);
});

test("stepsFromDescription parses markdown and html task lists", async () => {
	const created: Array<{ content: string; completed: boolean }> = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 10,
			title: "Task",
			description: `- [x] Add linting &amp; tests\n<li class="task-list-item"><input type="checkbox" checked><code>foo</code></li>\n<li class="task-list-item"><input type="checkbox">Review UI</li>`,
			steps: [
				{
					id: "existing",
					content: "Review UI",
					completed: false,
				},
			],
		});
	api.createStep = (_number, content, completed) => {
		created.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const steps = await Effect.runPromise(stepsFromDescription(makeEnv(api), 10));

	expect(steps).toEqual([
		{ content: "Add linting & tests", completed: true },
		{ content: "foo", completed: true },
	]);
	expect(created).toEqual([
		{ content: "Add linting & tests", completed: true },
		{ content: "foo", completed: true },
	]);
});

test("add with template extracts markdown step list into fizzy steps", async () => {
	const createCardInputs: Array<{
		board: string;
		title: string;
		description: string;
		columnId?: string;
	}> = [];
	const templateSteps: Array<{ content: string; completed: boolean }> = [];
	const actionLog: string[] = [];
	let listCardsCalls = 0;

	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listCards = (options) => {
		listCardsCalls += 1;
		return Effect.succeed(
			options?.all
				? []
				: [{ number: 99, title: "Legacy", assignees: [{ id: "identity-id", name: "me" }] }],
		);
	};
	api.createCard = (input) => {
		createCardInputs.push(input);
		return Effect.succeed({
			number: 101,
			title: input.title,
			description: input.description,
		});
	};
	api.assignCard = (number, userId) => {
		actionLog.push(`assign:${number}:${userId}`);
		return Effect.succeed(undefined);
	};
	api.triageCard = (number, columnId) => {
		actionLog.push(`triage:${number}:${columnId}`);
		return Effect.succeed(undefined);
	};
	api.showCard = () =>
		Effect.succeed({
			number: 101,
			title: "Add template steps",
			column: { id: "todo-id", name: "TODO" },
		});
	api.createStep = (_number, content, completed) => {
		templateSteps.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				users: {},
			},
		},
	};

	const description = `## Goal
Add parser support for template-based step extraction.

## Scope
- Keep add flow unchanged outside step parsing.

## Steps
- [x] Parse template section
- [ ] \`--radius-sm\` 降至 4rpx
- [ ] [Design token docs](https://example.com/design)
- [ ] ![radius token](assets/token.svg)
- [ ] **Plain**
- [ ] ~~Deprecated~~
- [ ] _Italic_
- [x] Parse template section`;
	const expectedCardDescription = `<h2>Goal</h2>
<p>Add parser support for template-based step extraction.</p>
<h2>Scope</h2>
<ul>
<li>Keep add flow unchanged outside step parsing.</li>
</ul>`;

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "Add template steps", description }),
	);

	expect(number).toBe(101);
	expect(createCardInputs).toEqual([
		{
			board: "board-1",
			title: "Add template steps",
			description: expectedCardDescription,
		},
	]);
	expect(actionLog).toEqual(["triage:101:todo-id", "assign:101:identity-id"]);
	expect(templateSteps).toEqual([
		{ content: "Parse template section", completed: true },
		{ content: "--radius-sm 降至 4rpx", completed: false },
		{ content: "Design token docs", completed: false },
		{ content: "radius token", completed: false },
		{ content: "Plain", completed: false },
		{ content: "Deprecated", completed: false },
		{ content: "Italic", completed: false },
	]);
	expect(listCardsCalls).toBe(4);
});

test("add without template steps section preserves card body conversion and skips step creation", async () => {
	const createCardInputs: Array<{
		board: string;
		title: string;
		description: string;
		columnId?: string;
	}> = [];
	const templateSteps: Array<{ content: string; completed: boolean }> = [];

	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listCards = () => Effect.succeed([]);
	api.createCard = (input) => {
		createCardInputs.push(input);
		return Effect.succeed({
			number: 102,
			title: input.title,
			description: input.description,
		});
	};
	api.triageCard = () => Effect.succeed(undefined);
	api.assignCard = () => Effect.succeed(undefined);
	api.showCard = () =>
		Effect.succeed({
			number: 102,
			title: "No template steps",
			column: { id: "todo-id", name: "TODO" },
		});
	api.createStep = (_number, content, completed) => {
		templateSteps.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				users: {
					me: "user-id",
				},
			},
		},
	};

	const description = `## Goal\nUpdate legacy flow add behavior.\n- [ ] Should stay in description body`;

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "No template steps", description }),
	);

	expect(number).toBe(102);
	expect(createCardInputs[0]!.description).toBe(`<h2>Goal</h2>
<p>Update legacy flow add behavior.</p>
<ul>
<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled>Should stay in description body</li>
</ul>`);
	expect(templateSteps).toEqual([]);
});

test("add applies planner metadata as tags when rendering html description", async () => {
	const tags: string[] = [];
	const createCardInputs: Array<{
		board: string;
		title: string;
		description: string;
		columnId?: string;
	}> = [];

	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listCards = () => Effect.succeed([]);
	api.createCard = (input) => {
		createCardInputs.push(input);
		return Effect.succeed({
			number: 103,
			title: input.title,
			description: input.description,
		});
	};
	api.triageCard = () => Effect.succeed(undefined);
	api.assignCard = () => Effect.succeed(undefined);
	api.tagCard = (_number, tag) => {
		tags.push(tag);
		return Effect.succeed(undefined);
	};
	api.showCard = () =>
		Effect.succeed({
			number: 103,
			title: "Metadata tags",
			column: { id: "todo-id", name: "TODO" },
		});

	const env = makeEnv(api);
	const description = `## Tags
- priority:p2
- type:chore
- phase:integration
- api_status:not_connected
- depends_on:123
- blocks:456

## Goal
Keep Fizzy UI readable.`;

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "Metadata tags", description }),
	);

	expect(number).toBe(103);
	expect(createCardInputs[0]!.description).toBe(`<h2>Goal</h2>
<p>Keep Fizzy UI readable.</p>`);
	expect(tags).toEqual([
		"priority:p2",
		"type:chore",
		"phase:integration",
		"api_status:not_connected",
		"depends_on:123",
		"blocks:456",
	]);
});

test("add prefers BACKLOG over legacy TODO when moving new cards", async () => {
	const triageCalls: Array<{ number: number; columnId: string }> = [];
	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listColumns = () =>
		Effect.succeed([
			{ id: "todo-id", name: "TODO" },
			{ id: "backlog-id", name: "BACKLOG" },
		]);
	api.listCards = () => Effect.succeed([]);
	api.createCard = (input) => {
		return Effect.succeed({
			number: 103,
			title: input.title,
			description: input.description,
		});
	};
	api.triageCard = (number, columnId) => {
		triageCalls.push({ number, columnId });
		return Effect.succeed(undefined);
	};
	api.assignCard = () => Effect.succeed(undefined);
	api.showCard = () =>
		Effect.succeed({
			number: 103,
			title: "Alias target",
			column: { id: "backlog-id", name: "BACKLOG" },
		});
	api.createStep = (_number, content, completed) => {
		// No template steps expected for this flow.
		void content;
		void completed;
		return Effect.succeed(undefined);
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				columns: {
					...baseConfig.flow.columns,
					todo: "missing-todo-id",
				},
				users: {
					me: "user-id",
				},
			},
		},
	};

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "Alias target", description: "body" }),
	);

	expect(number).toBe(103);
	expect(triageCalls).toEqual([{ number: 103, columnId: "backlog-id" }]);
});

test("add ignores configured MAYBE column when resolving backlog", async () => {
	const triageCalls: Array<{ number: number; columnId: string }> = [];
	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listColumns = () =>
		Effect.succeed([
			{ id: "maybe-id", name: "MAYBE" },
			{ id: "backlog-id", name: "BACKLOG" },
		]);
	api.listCards = () => Effect.succeed([]);
	api.createCard = (input) => {
		return Effect.succeed({
			number: 104,
			title: input.title,
			description: input.description,
		});
	};
	api.triageCard = (number, columnId) => {
		triageCalls.push({ number, columnId });
		return Effect.succeed(undefined);
	};
	api.assignCard = () => Effect.succeed(undefined);
	api.showCard = () =>
		Effect.succeed({
			number: 104,
			title: "Do not use maybe",
			column: { id: "backlog-id", name: "BACKLOG" },
		});

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				columns: {
					...baseConfig.flow.columns,
					todo: "maybe-id",
				},
				users: {
					me: "user-id",
				},
			},
		},
	};

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "Do not use maybe", description: "body" }),
	);

	expect(number).toBe(104);
	expect(triageCalls).toEqual([{ number: 104, columnId: "backlog-id" }]);
});

test("add fails when Fizzy keeps the card outside workflow columns", async () => {
	const api = defaultApi();
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity" });
	api.listColumns = () => Effect.succeed([{ id: "todo-id", name: "TODO" }]);
	api.listCards = () => Effect.succeed([]);
	api.createCard = (input) =>
		Effect.succeed({
			number: 105,
			title: input.title,
			description: input.description,
		});
	api.triageCard = () => Effect.succeed(undefined);
	api.assignCard = () => Effect.succeed(undefined);
	api.showCard = () => Effect.succeed({ number: 105, title: "Stuck", assignees: [] });

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
				users: {
					me: "user-id",
				},
			},
		},
	};

	let error: unknown;
	try {
		await Effect.runPromise(add(env, { user: "me", title: "Stuck", description: "body" }));
	} catch (cause) {
		error = cause;
	}

	expect(error).toBeInstanceOf(ValidationError);
	expect((error as Error).message).toContain("not in TODO");
});

test("assign supports current-user aliases and skips already assigned users", async () => {
	const assigned: string[] = [];
	const api = defaultApi();
	api.assignCard = (_number, userId) => {
		assigned.push(userId);
		return Effect.succeed(undefined);
	};
	api.identity = () => Effect.succeed({ userId: "identity-id", name: "Identity User" });
	api.listCards = () => Effect.succeed([]);
	api.listColumns = () => Effect.succeed([]);

	const env = {
		...makeEnv(api),
		cacheRepo: {
			read: () =>
				Effect.succeed({
					identity: { userId: "identity-id", name: "Identity User" },
					cards: [
						{
							number: 23,
							title: "Assign me",
							assignees: [{ id: "other-id", name: "Other" }],
						},
					],
					notNow: [],
					columns: [],
					users: { Other: "other-id" },
					syncedAt: "2026-01-01T00:00:00.000Z",
				}),
			write: () => Effect.succeed(undefined),
			ageSeconds: () => Effect.succeed(0),
		},
	};

	const result = await Effect.runPromise(assign(env, 23, ["me", "Other"]));

	expect(result).toEqual({ number: 23, userIds: ["identity-id"] });
	expect(assigned).toEqual(["identity-id"]);
});

test("buildStandardizedCommentBody escapes html in values", () => {
	const body = buildStandardizedCommentBody("done", 'feat: <a> & b "c" d\'');

	expect(body).toBe("<p>done: feat: &lt;a&gt; &amp; b &quot;c&quot; d&#39;</p>");
});

test("getStandardizedCommentTemplate returns English placeholders", () => {
	expect(getStandardizedCommentTemplate("done")).toBe("done: commit <sha>: <subject>");
});

test("done posts standardized escaped comment and closes card", async () => {
	const comments: string[] = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 20,
			title: "Done task",
			steps: [],
		});
	api.comment = (_number, body) => {
		comments.push(body);
		return Effect.succeed(undefined);
	};
	api.closeCard = () => Effect.succeed(undefined);
	api.identity = () => Effect.succeed({ userId: "identity-id" });
	api.listCards = (options) => {
		return Effect.succeed(Array.isArray(options?.all) ? [] : []);
	};

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
			},
		},
	};

	const result = await Effect.runPromise(done(env, 20, 'commit <x> & "y"'));

	expect(result).toEqual({ number: 20, ref: 'commit <x> & "y"' });
	expect(comments).toEqual(["<p>done: commit &lt;x&gt; &amp; &quot;y&quot;</p>"]);
});

test("done closes card without querying DONE column", async () => {
	const calls: string[] = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 20,
			title: "Done task",
			steps: [],
		});
	api.listColumns = () => Effect.fail(new ApiError({ message: "columns unavailable" }));
	api.closeCard = () => {
		calls.push("close");
		return Effect.succeed(undefined);
	};
	api.comment = () => {
		calls.push("comment");
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(done(makeEnv(api), 20, "commit abc: done"));

	expect(result).toEqual({ number: 20, ref: "commit abc: done" });
	expect(calls).toEqual(["close", "comment"]);
});

test("done closes card when cache refresh fails", async () => {
	const calls: string[] = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 20,
			title: "Done task",
			steps: [],
		});
	api.identity = () => Effect.fail(new ApiError({ message: "identity failed" }));
	api.listCards = () => Effect.fail(new ApiError({ message: "list cards failed" }));
	api.listColumns = () => Effect.fail(new ApiError({ message: "columns unavailable" }));
	api.closeCard = () => {
		calls.push("close");
		return Effect.succeed(undefined);
	};
	api.comment = () => {
		calls.push("comment");
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(done(makeEnv(api), 20, "commit abc: done"));

	expect(result).toEqual({ number: 20, ref: "commit abc: done" });
	expect(calls).toEqual(["close", "comment"]);
});

test("block posts standardized escaped comment", async () => {
	const comments: string[] = [];
	const api = defaultApi();
	api.comment = (_number, body) => {
		comments.push(body);
		return Effect.succeed(undefined);
	};
	api.postponeCard = () => Effect.succeed(undefined);
	api.identity = () => Effect.succeed({ userId: "identity-id" });
	api.listCards = () => Effect.succeed([]);

	const env = {
		...makeEnv(api),
		config: {
			...baseConfig,
			flow: {
				...baseConfig.flow,
			},
		},
	};

	const result = await Effect.runPromise(block(env, 21, 'bad <html> & chars "x"'));

	expect(result).toEqual({ number: 21, reason: 'bad <html> & chars "x"' });
	expect(comments).toEqual(["<p>blocked: bad &lt;html&gt; &amp; chars &quot;x&quot;</p>"]);
});

test("standardizeCard extracts old markdown sections and normalizes steps", async () => {
	const descriptions: string[] = [];
	const created: Array<{ content: string; completed: boolean }> = [];
	const updated: Array<{ stepId: string; content?: string; completed?: boolean }> = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 30,
			title: "[Infra] radius tokens",
			description: `## Goal
Shrink radius tokens.

## Done When
- [ ] \`--radius-sm\` 降至 4rpx
- [ ] pnpm check 通过

## Files
- \`src/app.css\`

## References
- stale figma node

## Backup
Ray`,
			steps: [{ id: "s1", content: "`--radius-md` 降至 8rpx", completed: false }],
		});
	api.updateCardDescription = (_number, description) => {
		descriptions.push(description);
		return Effect.succeed(undefined);
	};
	api.updateStep = (_number, stepId, input) => {
		updated.push({ stepId, ...input });
		return Effect.succeed(undefined);
	};
	api.createStep = (_number, content, completed) => {
		created.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(standardizeCard(makeEnv(api), 30));

	expect(result).toEqual({
		number: 30,
		descriptionUpdated: true,
		stepsCreated: 0,
		stepsUpdated: 1,
		stepsCompleted: 0,
	});
	expect(descriptions[0]).toContain("Goal");
	expect(descriptions[0]).toContain("Shrink radius tokens.");
	expect(descriptions[0]).toContain("Files");
	expect(descriptions[0]).toContain("Verification");
	expect(descriptions[0]).not.toContain("References");
	expect(descriptions[0]).not.toContain("Backup");
	expect(created).toEqual([]);
	expect(updated).toEqual([{ stepId: "s1", content: "--radius-md 降至 8rpx" }]);
});

test("standardizeCard parses old html and completes closed card steps", async () => {
	const created: Array<{ content: string; completed: boolean }> = [];
	const updated: Array<{ stepId: string; content?: string; completed?: boolean }> = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 31,
			title: "Closed task",
			closed: true,
			descriptionHtml:
				"<div><h2>Goal</h2><p>Ship it.</p><h2>Done When</h2><ul><li><code>pnpm check</code> passed</li></ul></div>",
			steps: [{ id: "s1", content: "`old` step", completed: false }],
		});
	api.updateCardDescription = () => Effect.succeed(undefined);
	api.updateStep = (_number, stepId, input) => {
		updated.push({ stepId, ...input });
		return Effect.succeed(undefined);
	};
	api.createStep = (_number, content, completed) => {
		created.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(standardizeCard(makeEnv(api), 31));

	expect(result.stepsCreated).toBe(0);
	expect(result.stepsUpdated).toBe(1);
	expect(result.stepsCompleted).toBe(1);
	expect(created).toEqual([]);
	expect(updated).toEqual([{ stepId: "s1", content: "old step", completed: true }]);
});

test("standardizeCard creates steps from old done-when when no steps exist", async () => {
	const created: Array<{ content: string; completed: boolean }> = [];
	const api = defaultApi();
	api.showCard = () =>
		Effect.succeed({
			number: 32,
			title: "Create steps",
			description: `## Goal
Do work.

## Done When
- [ ] \`pnpm check\` 通过
- [x] screenshot verified`,
			steps: [],
		});
	api.updateCardDescription = () => Effect.succeed(undefined);
	api.createStep = (_number, content, completed) => {
		created.push({ content, completed: Boolean(completed) });
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(standardizeCard(makeEnv(api), 32));

	expect(result.stepsCreated).toBe(2);
	expect(created).toEqual([
		{ content: "pnpm check 通过", completed: false },
		{ content: "screenshot verified", completed: true },
	]);
});

test("standardizeBoard standardizes unique open and closed cards", async () => {
	const standardized: number[] = [];
	const api = defaultApi();
	api.listCards = (options) =>
		Effect.succeed(
			options?.indexedBy === "closed"
				? [
						{ number: 41, title: "Closed", description: "closed" },
						{ number: 40, title: "Duplicate", description: "duplicate" },
					]
				: [
						{ number: 40, title: "Open", description: "open" },
						{ number: 42, title: "Open 2", description: "open 2" },
					],
		);
	api.showCard = (number) =>
		Effect.succeed({ number, title: `Card ${number}`, description: `card ${number}` });
	api.updateCardDescription = (number) => {
		standardized.push(number);
		return Effect.succeed(undefined);
	};

	const result = await Effect.runPromise(standardizeBoard(makeEnv(api)));

	expect(result.total).toBe(3);
	expect(standardized.sort()).toEqual([40, 41, 42]);
});

test("convertDescription passes through input unchanged", () => {
	expect(convertDescription("<div>html</div>")).toBe("<div>html</div>");
	expect(convertDescription("**bold**")).toBe("**bold**");
	expect(convertDescription("hello world")).toBe("hello world");
	expect(convertDescription("")).toBe("");
});
