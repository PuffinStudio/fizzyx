import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ApiError, ConfigError, FileError, ValidationError } from "../src/domain/errors";
import type { ConfigRepository } from "../src/ports/config-repository";
import type { FizzyApi } from "../src/ports/fizzy-api";
import {
	add,
	completeSteps,
	buildStandardizedCommentBody,
	getStandardizedCommentTemplate,
	done,
	resolveDoneRefFromGit,
	block,
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
		card: {
			language: "zh-CN" as const,
		},
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
	}) as ConfigRepository;

const defaultApi = () =>
	({
		identity: () => Effect.fail(new ApiError({ message: "identity not mocked" })),
		listColumns: () => Effect.fail(new ApiError({ message: "listColumns not mocked" })),
		listBoards: () => Effect.fail(new ApiError({ message: "listBoards not mocked" })),
		listCards: () => Effect.fail(new ApiError({ message: "listCards not mocked" })),
		showCard: () => Effect.fail(new ApiError({ message: "showCard not mocked" })),
		listComments: () => Effect.fail(new ApiError({ message: "listComments not mocked" })),
		createColumn: () => Effect.fail(new ApiError({ message: "createColumn not mocked" })),
		createCard: () => Effect.fail(new ApiError({ message: "createCard not mocked" })),
		assignCard: () => Effect.fail(new ApiError({ message: "assignCard not mocked" })),
		selfAssignCard: () => Effect.fail(new ApiError({ message: "selfAssignCard not mocked" })),
		moveCard: () => Effect.fail(new ApiError({ message: "moveCard not mocked" })),
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

const makeTempDir = (): string => mkdtempSync(join(tmpdir(), "fizzyx-cli-"));

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
	const createCardInputs: Array<{ board: string; title: string; description: string }> = [];
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
	api.moveCard = (number, columnId) => {
		actionLog.push(`move:${number}:${columnId}`);
		return Effect.succeed(undefined);
	};
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
				card: {
					language: "zh-CN" as const,
				},
				users: {
					me: "user-id",
				},
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
	const expectedCardDescription = `## Goal\nAdd parser support for template-based step extraction.\n\n## Scope\n- Keep add flow unchanged outside step parsing.`;

	const number = await Effect.runPromise(
		add(env, { user: "me", title: "Add template steps", description }),
	);

	expect(number).toBe(101);
	expect(createCardInputs).toEqual([
		{
			board: "board-1",
			title: "Add template steps",
			description: Bun.markdown.html(expectedCardDescription),
		},
	]);
	expect(actionLog).toEqual(["assign:101:user-id", "move:101:todo-id"]);
	expect(templateSteps).toEqual([
		{ content: "Parse template section", completed: true },
		{ content: "--radius-sm 降至 4rpx", completed: false },
		{ content: "Design token docs", completed: false },
		{ content: "radius token", completed: false },
		{ content: "Plain", completed: false },
		{ content: "Deprecated", completed: false },
		{ content: "Italic", completed: false },
	]);
	expect(listCardsCalls).toBe(2);
});

test("add without template steps section preserves card body conversion and skips step creation", async () => {
	const createCardInputs: Array<{ board: string; title: string; description: string }> = [];
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
	api.assignCard = () => Effect.succeed(undefined);
	api.moveCard = () => Effect.succeed(undefined);
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
				card: {
					language: "zh-CN" as const,
				},
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
	expect(createCardInputs[0]!.description).toBe(Bun.markdown.html(description));
	expect(templateSteps).toEqual([]);
});

test("buildStandardizedCommentBody escapes html in values", () => {
	const body = buildStandardizedCommentBody("zh-CN", "done", 'feat: <a> & b "c" d\'');

	expect(body).toBe("<p>完成：feat: &lt;a&gt; &amp; b &quot;c&quot; d&#39;</p>");
});

test("getStandardizedCommentTemplate returns localized placeholders", () => {
	expect(getStandardizedCommentTemplate("en", "done")).toBe("done: commit <sha>: <subject>");
	expect(getStandardizedCommentTemplate("zh-CN", "done")).toBe("完成：commit <sha>: <subject>");
	expect(getStandardizedCommentTemplate("mixed", "done")).toBe("完成：commit <sha>: <subject>");
	expect(getStandardizedCommentTemplate("mixed", "blocked")).toBe("阻塞：<原因；需要谁/什么决策>");
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
				card: {
					language: "en" as const,
				},
			},
		},
	};

	const result = await Effect.runPromise(done(env, 20, 'commit <x> & "y"'));

	expect(result).toEqual({ number: 20, ref: 'commit <x> & "y"' });
	expect(comments).toEqual(["<p>done: commit &lt;x&gt; &amp; &quot;y&quot;</p>"]);
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
				card: {
					language: "zh-CN" as const,
				},
			},
		},
	};

	const result = await Effect.runPromise(block(env, 21, 'bad <html> & chars "x"'));

	expect(result).toEqual({ number: 21, reason: 'bad <html> & chars "x"' });
	expect(comments).toEqual(["<p>阻塞：bad &lt;html&gt; &amp; chars &quot;x&quot;</p>"]);
});
