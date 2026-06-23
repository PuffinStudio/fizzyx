import { Console, Effect } from "effect";
import { ApiError, AuthError, ConfigError, FileError, ValidationError } from "../domain/errors";
import type {
	BoardCache,
	BoardColumn,
	Step,
	Identity,
	InitializedProjectConfig,
	ProjectConfig,
} from "../domain/models";
import type { CacheRepository } from "../ports/cache-repository";
import type { ConfigRepository, SetupProjectConfigInput } from "../ports/config-repository";

import type { FizzyApi } from "../ports/fizzy-api";
import { ConfigRepo, CONFIG_FILE } from "../ports/config-repository";
import { isTaggedErrorWithMessage } from "../_shared/helpers";
import { makeBunCacheRepository } from "../adapters/bun-cache-repository";
import { makeFetchFizzyApi } from "../adapters/fetch-fizzy-api";
import {
	convertDescription,
	parseTemplateDescription,
	planStandardizeCardContent,
	planStepsFromDescription,
} from "./flow-card-content";
import {
	buildBoardUsers,
	mergeFlowUsers,
	resolveAssignableUser,
	resolveMineUser,
	resolveUser,
} from "./flow-user-resolution";
export { convertDescription } from "./flow-card-content";
export { resolveUser } from "./flow-user-resolution";

export interface Env {
	config: ProjectConfig;
	configRepo: ConfigRepository;
	cacheRepo: CacheRepository;
	api: FizzyApi;
}

export interface InitializedEnv extends Env {
	config: InitializedProjectConfig;
}

const DEFAULT_ACCOUNT = "1";
const DEFAULT_API_URL = "https://fizzy.puffin.studio";

type StandardizedCommentKind = "done" | "blocked" | "unblocked" | "handoff" | "note";

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const standardizedCommentTemplate = (kind: StandardizedCommentKind): string => {
	return {
		done: "done: ",
		blocked: "blocked: ",
		unblocked: "unblocked: ",
		handoff: "handoff: ",
		note: "note: ",
	}[kind];
};

export const buildStandardizedCommentBody = (
	kind: StandardizedCommentKind,
	value: string,
): string => `<p>${standardizedCommentTemplate(kind)}${escapeHtml(value)}</p>`;

export const getStandardizedCommentTemplate = (kind: StandardizedCommentKind): string => {
	if (kind === "done") {
		return "done: commit <sha>: <subject>";
	}

	if (kind === "blocked") {
		return "blocked: <reason; owner/decision needed>";
	}

	if (kind === "unblocked") {
		return "unblocked: <resource/decision ready>";
	}

	if (kind === "handoff") {
		return "handoff: <current state; next step>";
	}

	return "note: <brief note>";
};

export const makeEnv = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* configRepo.loadProjectConfig();
	const board = yield* requireBoard(config);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(
		Effect.catch(() =>
			Effect.fail(
				new AuthError({
					message: `No token for account ${config.account}. Run: fizzyx auth login <token>`,
				}),
			),
		),
	);
	const cacheRepo = makeBunCacheRepository(config.account, board);
	const api = makeFetchFizzyApi(config, credentials.token);
	return { config, configRepo, cacheRepo, api } satisfies Env;
});

export const makeFlowEnv = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* configRepo.loadProjectConfig();
	const board = yield* requireBoard(config);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(
		Effect.catch(() =>
			Effect.fail(
				new AuthError({
					message: `No token for account ${config.account}. Run: fizzyx auth login <token>`,
				}),
			),
		),
	);
	const cacheRepo = makeBunCacheRepository(config.account, board);
	const api = makeFlowApiWithAuthRetry(configRepo, config, credentials.token);
	const initializedConfig = yield* ensureFlowConfig({ configRepo, api, config });

	return { config: initializedConfig, configRepo, cacheRepo, api } satisfies InitializedEnv;
});

const loadConfigOrDefaults = (
	configRepo: ConfigRepository,
): Effect.Effect<ProjectConfig, ConfigError | FileError> =>
	Effect.gen(function* () {
		const config = yield* configRepo.loadProjectConfigOptional().pipe(
			Effect.catchDefect((cause) =>
				isTaggedErrorWithMessage(cause, "ConfigError") && isMissingConfigError(cause.message)
					? Effect.succeed(undefined)
					: Effect.fail(cause as ConfigError | FileError),
			),
			Effect.catch((cause) =>
				isTaggedErrorWithMessage(cause, "ConfigError") && isMissingConfigError(cause.message)
					? Effect.succeed(undefined)
					: Effect.fail(cause as ConfigError | FileError),
			),
		);

		return (
			config || {
				apiUrl: DEFAULT_API_URL,
				account: DEFAULT_ACCOUNT,
				configPath: `${process.cwd()}/${CONFIG_FILE}`,
				rootDir: process.cwd(),
			}
		);
	});

const isMissingConfigError = (message: string): boolean =>
	message.startsWith(`No .fizzyx.yaml`) || message.startsWith(`No .fizzy.yaml`);

const requireBoard = (config: ProjectConfig): Effect.Effect<string, ValidationError> =>
	config.board
		? Effect.succeed(config.board)
		: Effect.fail(
				new ValidationError({ message: "No board configured. Run: fizzyx setup <board-id>" }),
			);

export const setup = (input: SetupProjectConfigInput) =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		if (!input.board) {
			return yield* new ValidationError({ message: "board is required" });
		}

		const account = input.account || DEFAULT_ACCOUNT;
		const apiUrl = input.apiUrl || DEFAULT_API_URL;
		const defaults: ProjectConfig = {
			apiUrl,
			account,
			board: input.board,
			configPath: `${process.cwd()}/${CONFIG_FILE}`,
			rootDir: process.cwd(),
		};

		const credentials = yield* configRepo.loadCredentials(account).pipe(
			Effect.catch(() =>
				Effect.fail(
					new AuthError({
						message: `No token for account ${account}. Run: fizzyx auth login <token>`,
					}),
				),
			),
		);
		const api = makeFlowApiWithAuthRetry(configRepo, defaults, credentials.token);

		if (input.todoColumn && input.inProgressColumn) {
			return yield* configRepo.setupProjectConfig({
				account,
				board: input.board,
				todoColumn: input.todoColumn,
				inProgressColumn: input.inProgressColumn,
				users: input.users || {},
				apiUrl,
			});
		}

		return yield* ensureFlowConfig({
			configRepo,
			api,
			config: defaults,
			initialUsers: input.users,
		});
	});

export const listBoards = () =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* loadConfigOrDefaults(configRepo);
		const credentials = yield* configRepo.loadCredentials(config.account).pipe(
			Effect.catch(() =>
				Effect.fail(
					new AuthError({
						message: `No token for account ${config.account}. Run: fizzyx auth login <token>`,
					}),
				),
			),
		);
		const api = makeFlowApiWithAuthRetry(configRepo, config, credentials.token);
		return yield* api.listBoards();
	});

const makeFlowApiWithAuthRetry = (
	configRepo: ConfigRepository,
	config: ProjectConfig,
	initialToken: string,
): FizzyApi => {
	let token = initialToken;
	let api = makeFetchFizzyApi(config, token);

	const toApiError = (cause: unknown): ApiError =>
		cause instanceof ApiError ? cause : new ApiError({ message: String(cause) });

	const withAuthRetry = <T>(
		action: (api: FizzyApi) => Effect.Effect<T, ApiError>,
	): Effect.Effect<T, ApiError> =>
		Effect.gen(function* () {
			const first = yield* action(api).pipe(
				Effect.map((right) => ({ _tag: "right", right }) as const),
				Effect.catch((failure) =>
					Effect.succeed({ _tag: "left", left: toApiError(failure) } as const),
				),
			);

			if (first._tag === "right") {
				return first.right;
			}

			const failure = first.left;
			if (!isUnauthorizedApiError(failure)) {
				return yield* Effect.fail(failure);
			}

			const migrated = yield* configRepo
				.migrateCredentialsFromOfficial(config.account)
				.pipe(Effect.catch(() => Effect.fail(failure)));

			if (migrated.token !== token) {
				token = migrated.token;
				api = makeFetchFizzyApi(config, token);
				yield* configRepo.saveCredentials(config.account, migrated).pipe(
					Effect.catch(
						(cause) =>
							new ApiError({
								message: `Failed to persist migrated credentials: ${
									cause instanceof FileError ? cause.message : String(cause)
								}`,
							}),
					),
				);
			}

			return yield* action(api);
		});

	return {
		identity: () => withAuthRetry((api) => api.identity()),
		listBoards: () => withAuthRetry((api) => api.listBoards()),
		listCards: (options) => withAuthRetry((api) => api.listCards(options)),
		showCard: (number) => withAuthRetry((api) => api.showCard(number)),
		listComments: (number) => withAuthRetry((api) => api.listComments(number)),
		listColumns: () => withAuthRetry((api) => api.listColumns()),
		createColumn: (name) => withAuthRetry((api) => api.createColumn(name)),
		createCard: (input) => withAuthRetry((api) => api.createCard(input)),
		updateCardDescription: (number, description) =>
			withAuthRetry((api) => api.updateCardDescription(number, description)),
		assignCard: (number, userId) => withAuthRetry((api) => api.assignCard(number, userId)),
		moveCard: (number, columnId) => withAuthRetry((api) => api.moveCard(number, columnId)),
		comment: (number, body) => withAuthRetry((api) => api.comment(number, body)),
		closeCard: (number) => withAuthRetry((api) => api.closeCard(number)),
		postponeCard: (number) => withAuthRetry((api) => api.postponeCard(number)),
		updateStep: (number, stepId, input) =>
			withAuthRetry((api) => api.updateStep(number, stepId, input)),
		createStep: (number, content, completed) =>
			withAuthRetry((api) => api.createStep(number, content, completed)),
	} satisfies FizzyApi;
};

const isUnauthorizedApiError = (error: ApiError): boolean => error.status === 401;

export const initFlow = () =>
	Effect.gen(function* () {
		const env = yield* makeFlowEnv;
		return env.config.flow;
	});

export const authLogin = (token: string) =>
	Effect.gen(function* () {
		const configRepo = yield* ConfigRepo;
		const config = yield* loadConfigOrDefaults(configRepo);
		yield* configRepo.saveCredentials(config.account, { token });
		return config.account;
	});

export const authStatus = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* loadConfigOrDefaults(configRepo);
	const credentials = yield* configRepo.loadCredentials(config.account).pipe(Effect.option);
	if (credentials._tag === "None") {
		return {
			account: config.account,
			board: config.board,
			authenticated: false,
		};
	}

	const api = makeFetchFizzyApi(config, credentials.value.token);
	const identityResult = yield* api.identity().pipe(
		Effect.map((identity) => ({ _tag: "success", identity }) as const),
		Effect.catch((cause) =>
			Effect.succeed({
				_tag: "failure",
				error: cause instanceof Error ? cause.message : String(cause),
			} as const),
		),
	);

	return {
		account: config.account,
		board: config.board,
		authenticated: true,
		identity: identityResult._tag === "success" ? identityResult.identity : undefined,
		identityError: identityResult._tag === "failure" ? identityResult.error : undefined,
	};
});

export const authLogout = Effect.gen(function* () {
	const configRepo = yield* ConfigRepo;
	const config = yield* loadConfigOrDefaults(configRepo);
	yield* configRepo.deleteCredentials(config.account);
	return config.account;
});

export const syncBoard = (env: Env) =>
	Effect.gen(function* () {
		const [identity, cards, notNow, columns] = yield* Effect.all([
			env.api.identity(),
			env.api.listCards({ all: true }),
			env.api.listCards({ indexedBy: "not_now", all: true }),
			env.api.listColumns(),
		]);
		const users = buildBoardUsers(env.config, cards);
		const cache: BoardCache = {
			identity,
			cards,
			notNow,
			columns,
			users,
			syncedAt: new Date().toISOString(),
		};
		yield* env.cacheRepo.write(cache);
		return cache;
	});

export const ensureCache = (env: InitializedEnv, fresh: boolean) =>
	Effect.gen(function* () {
		const age = yield* env.cacheRepo.ageSeconds();
		if (fresh || age > env.config.flow.cacheTtlSeconds) {
			return yield* syncBoard(env);
		}
		const cache = yield* env.cacheRepo.read();
		if (cache) return cache;
		return yield* syncBoard(env);
	});

export const mine = (env: InitializedEnv, options: { fresh: boolean; user?: string }) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, options.fresh);
		const { name, userId } = resolveMineUser(env.config, cache, options.user);
		const cards = cache.cards.filter((card) =>
			card.assignees?.some((assignee) => assignee.id === userId),
		);
		return { name, userId, cards };
	});

export const status = (env: InitializedEnv, options: { fresh: boolean }) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, options.fresh);
		const age = yield* env.cacheRepo.ageSeconds();
		return { cache, age };
	});

export const show = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const comments = yield* env.api
			.listComments(number)
			.pipe(Effect.catch(() => Effect.succeed([])));
		return { card, comments: comments.slice(-3) };
	});

export const next = (env: InitializedEnv, options: { fresh: boolean }) =>
	Effect.gen(function* () {
		const result = yield* mine(env, { fresh: options.fresh });
		const card = result.cards.find((item) => item.column?.id === env.config.flow.columns.todo);
		return { user: result, card };
	});

export const start = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, true);
		const target = cache.cards.find((card) => card.number === number);
		if (!target) return yield* new ValidationError({ message: `Card #${number} not found` });
		const userId = cache.identity.userId;
		const active = cache.cards.filter(
			(card) =>
				(card.column?.id === env.config.flow.columns.inProgress ||
					card.column?.name === "INPROGRESS") &&
				card.assignees?.some((assignee) => assignee.id === userId),
		);
		if (active.length >= env.config.flow.wipLimit) {
			return yield* new ValidationError({
				message: `Current user already has ${active.length} INPROGRESS cards`,
			});
		}
		yield* env.api.moveCard(number, env.config.flow.columns.inProgress);
		if (!target.assignees?.some((assignee) => assignee.id === userId)) {
			yield* env.api.assignCard(number, userId);
		}
		yield* syncBoard(env);
		return number;
	});

export const done = (env: InitializedEnv, number: number, ref?: string) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const unfinished = (card.steps || []).filter((step) => !step.completed);
		if (unfinished.length > 0) {
			const formatted = unfinished.map((step) => `- ${step.content || "(no content)"}`).join("\n");
			return yield* new ValidationError({
				message: `Cannot close #${number}: unfinished steps remain\n${formatted}`,
			});
		}

		const finalRef = ref || "done";
		yield* env.api.closeCard(number);
		yield* env.api
			.comment(number, buildStandardizedCommentBody("done", finalRef))
			.pipe(Effect.catch(() => Effect.succeed(undefined)));
		yield* syncBoard(env).pipe(Effect.catch(() => Effect.succeed(undefined)));
		return { number, ref: finalRef };
	});

export const resolveDoneRefFromGit = (options: { cwd?: string } = {}) =>
	Effect.gen(function* () {
		const cwd = options.cwd || process.cwd();
		const [short, subject] = yield* Effect.all([
			gitCommandOutput(cwd, ["rev-parse", "--short", "HEAD"]),
			gitCommandOutput(cwd, ["log", "-1", "--format=%s"]),
		]);

		if (short === "" || subject === "") {
			return yield* new ValidationError({
				message: "Cannot derive done ref from git. Pass an explicit ref.",
			});
		}

		return `commit ${short}: ${subject}`;
	});

export const block = (env: InitializedEnv, number: number, reason: string) =>
	Effect.gen(function* () {
		if (!reason.trim()) return yield* new ValidationError({ message: "Block reason is required" });
		yield* env.api.comment(number, buildStandardizedCommentBody("blocked", reason));
		yield* env.api.postponeCard(number);
		yield* syncBoard(env);
		return { number, reason };
	});

export const add = (
	env: InitializedEnv,
	input: { user: string; title: string; description: string },
) =>
	Effect.gen(function* () {
		if (!env.config.board) {
			return yield* new ValidationError({ message: "board is required" });
		}

		const parsed = parseTemplateDescription(input.description);
		const userId = resolveUser(env.config, input.user);
		const card = yield* env.api.createCard({
			title: input.title,
			description: convertDescription(parsed.cardDescription),
			board: env.config.board,
		});
		yield* env.api.assignCard(card.number, userId);
		yield* env.api.moveCard(card.number, env.config.flow.columns.todo);
		yield* Effect.forEach(parsed.templateSteps, (step) =>
			env.api.createStep(card.number, step.content, step.completed),
		);
		yield* syncBoard(env);
		return card.number;
	});

export const repairMarkdownDescription = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const description = convertDescription(card.description || "");
		const original = card.description || "";
		if (description !== original) {
			yield* env.api.updateCardDescription(number, description);
		}
		yield* syncBoard(env);
		return number;
	});

export const completeSteps = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const pending = (card.steps || []).filter((step) => !step.completed);
		const missingIds = pending.filter((step) => !step.id);
		if (missingIds.length > 0) {
			const steps = missingIds.map((step) => `- ${step.content || "(no content)"}`).join("\n");
			return yield* new ValidationError({
				message: `Cannot complete steps for #${number}: missing step id for:\n${steps}`,
			});
		}

		const toComplete = pending.filter(
			(step): step is Step & { id: string } => typeof step.id === "string",
		);
		yield* Effect.forEach(toComplete, (step) =>
			env.api.updateStep(number, step.id, {
				completed: true,
			}),
		);

		yield* syncBoard(env);
		return {
			number,
			updatedCount: toComplete.length,
			contents: toComplete.map((step) => step.content),
		};
	});

export const stepsFromDescription = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const steps = planStepsFromDescription(card);
		yield* Effect.forEach(steps, (step) =>
			env.api.createStep(number, step.content, step.completed),
		);
		return steps;
	});

export interface StandardizeCardResult {
	number: number;
	descriptionUpdated: boolean;
	stepsCreated: number;
	stepsUpdated: number;
	stepsCompleted: number;
}

export const standardizeCard = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const plan = planStandardizeCardContent(card);
		if (plan.description !== undefined) {
			yield* env.api.updateCardDescription(card.number, plan.description);
		}
		yield* Effect.forEach(plan.stepUpdates, (update) =>
			env.api.updateStep(card.number, update.stepId, update.input),
		);
		yield* Effect.forEach(plan.stepCreates, (step) =>
			env.api.createStep(card.number, step.content, step.completed),
		);
		return plan.result;
	});

export const standardizeBoard = (env: InitializedEnv) =>
	Effect.gen(function* () {
		const [openCards, closedCards] = yield* Effect.all([
			env.api.listCards({ all: true }),
			env.api.listCards({ indexedBy: "closed", all: true }),
		]);
		const seen = new Set<number>();
		const cards = openCards.concat(closedCards).filter((card) => {
			if (seen.has(card.number)) return false;
			seen.add(card.number);
			return true;
		});

		const results = yield* Effect.forEach(cards, (card) => standardizeCard(env, card.number));
		return {
			results,
			total: results.length,
			descriptionUpdated: results.filter((result) => result.descriptionUpdated).length,
			stepsCreated: results.reduce((total, result) => total + result.stepsCreated, 0),
			stepsUpdated: results.reduce((total, result) => total + result.stepsUpdated, 0),
			stepsCompleted: results.reduce((total, result) => total + result.stepsCompleted, 0),
		};
	});

const ensureFlowConfig = (args: {
	configRepo: ConfigRepository;
	api: FizzyApi;
	config: ProjectConfig;
	initialUsers?: Record<string, string>;
}): Effect.Effect<InitializedProjectConfig, unknown> =>
	Effect.gen(function* () {
		const identityResult = yield* args.api.identity().pipe(
			Effect.map((identity): { _tag: "success"; identity: Identity } => ({
				_tag: "success",
				identity,
			})),
			Effect.catch(() => Effect.succeed({ _tag: "failure" } as const)),
		);

		const cards = yield* args.api
			.listCards({ all: true })
			.pipe(Effect.catch(() => Effect.succeed([] as const)));
		const existingUsers = mergeFlowUsers({
			config: args.config,
			initialUsers: args.initialUsers,
			cards,
			identity: identityResult._tag === "success" ? identityResult.identity : undefined,
		});

		if (args.config.flow) {
			if (!isUserMapChanged(args.config.flow.users, existingUsers)) {
				return args.config as InitializedProjectConfig;
			}

			return yield* args.configRepo.setupProjectConfig({
				account: args.config.account,
				board: args.config.board,
				todoColumn: args.config.flow.columns.todo,
				inProgressColumn: args.config.flow.columns.inProgress,
				users: existingUsers,
				apiUrl: args.config.apiUrl,
				configPath: args.config.configPath,
			});
		}

		yield* Console.log("flow config missing; initializing...");
		const columns = yield* args.api.listColumns();
		const todoColumn = yield* ensureColumn(columns, "TODO", () => args.api.createColumn("TODO"));
		const inProgressColumn = yield* ensureColumn(columns, "INPROGRESS", () =>
			args.api.createColumn("INPROGRESS"),
		);
		return yield* args.configRepo.setupProjectConfig({
			account: args.config.account,
			board: args.config.board,
			todoColumn,
			inProgressColumn,
			users: existingUsers,
			apiUrl: args.config.apiUrl,
			configPath: args.config.configPath,
		});
	});

const isUserMapChanged = (
	current: Record<string, string>,
	next: Record<string, string>,
): boolean => {
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) return true;

	for (const [key, value] of Object.entries(next)) {
		if (current[key] !== value) return true;
	}

	return false;
};

const ensureColumn = (
	columns: ReadonlyArray<BoardColumn>,
	name: string,
	createColumn: () => Effect.Effect<BoardColumn, unknown>,
): Effect.Effect<string, unknown> =>
	Effect.gen(function* () {
		const lower = name.toLowerCase();
		const existing = columns.find((column) => column.name.toLowerCase() === lower);
		if (existing?.id) return existing.id;

		const created = yield* createColumn();
		return created.id;
	});

export const assign = (env: InitializedEnv, number: number, users: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		if (users.length === 0)
			return yield* new ValidationError({ message: "At least one user is required" });
		const cache = yield* ensureCache(env, false);
		const userIds = users.map((user) => resolveAssignableUser(cache, user));
		const card =
			cache.cards.find((item) => item.number === number) ?? (yield* env.api.showCard(number));
		const existing = new Set(card.assignees?.map((assignee) => assignee.id) ?? []);
		const toAssign = userIds.filter((userId) => !existing.has(userId));
		yield* Effect.forEach(toAssign, (userId) => env.api.assignCard(number, userId), {
			discard: true,
		});
		yield* syncBoard(env);
		return { number, userIds: toAssign };
	});

export interface DoctorResult {
	account: string;
	apiUrl: string;
	boardId: string;
	columns: { name: string; id: string; found: boolean }[];
	allColumns: ReadonlyArray<BoardColumn>;
	systemActions: ReadonlyArray<{ name: string; via: string }>;
	configUpdated: boolean;
	info: string[];
	fixes: string[];
}

export const doctor = (env: InitializedEnv): Effect.Effect<DoctorResult, unknown> =>
	Effect.gen(function* () {
		const cache = yield* env.cacheRepo.read().pipe(Effect.catch(() => Effect.succeed(null)));
		const config = env.config;
		const info: string[] = [];
		const fixes: string[] = [];
		let columnsData = cache?.columns;

		if (!columnsData || columnsData.length === 0) {
			info.push("Fetched columns from API (not cached)");
			columnsData = yield* env.api.listColumns();
		}

		const expected = ["TODO", "INPROGRESS"];
		const columns: DoctorResult["columns"] = [];

		for (const name of expected) {
			const match = columnsData.find((c) => c.name.toLowerCase() === name.toLowerCase());
			if (!match) {
				fixes.push(`Created missing column "${name}"`);
				const created = yield* env.api.createColumn(name);
				columnsData = columnsData.concat(created);
				columns.push({ name, id: created.id, found: true });
			} else {
				columns.push({ name, id: match.id, found: true });
			}
		}

		const todoId = columns[0]!.id;
		const inProgressId = columns[1]!.id;
		let configUpdated = false;

		if (config.flow?.columns.todo !== todoId || config.flow?.columns.inProgress !== inProgressId) {
			fixes.push("Updated column IDs in config");
			yield* env.configRepo.setupProjectConfig({
				account: config.account,
				board: config.board,
				todoColumn: todoId,
				inProgressColumn: inProgressId,
				users: config.flow?.users,
				apiUrl: config.apiUrl,
				configPath: config.configPath,
			});
			configUpdated = true;
		}

		return {
			account: config.account,
			apiUrl: config.apiUrl,
			boardId: config.board ?? "(unknown)",
			columns,
			allColumns: columnsData,
			systemActions: [
				{ name: "DONE", via: "closure endpoint" },
				{ name: "NOT_NOW", via: "not_now endpoint" },
			],
			configUpdated,
			info,
			fixes,
		};
	});

const gitCommandOutput = (cwd: string, args: ReadonlyArray<string>) =>
	Effect.tryPromise({
		try: async () => {
			const proc = Bun.spawn({
				cmd: ["git", ...args],
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});

			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);

			if (exitCode !== 0) {
				throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
			}

			return stdout.trim();
		},
		catch: (cause) =>
			new ValidationError({
				message: `Unable to derive done ref from git: ${String(cause)}. Pass an explicit ref.`,
			}),
	});
