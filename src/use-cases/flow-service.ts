import { Effect } from "effect";
import { ApiError, AuthError, ConfigError, FileError, ValidationError } from "../domain/errors";
import type {
	BoardCache,
	BoardColumn,
	Card,
	FlowCardLanguage,
	Step,
	Identity,
	InitializedProjectConfig,
	ProjectConfig,
} from "../domain/models";
import type { CacheRepository } from "../ports/cache-repository";
import type { ConfigRepository, SetupProjectConfigInput } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { ConfigRepo } from "../ports/config-repository";
import { makeBunCacheRepository } from "../adapters/bun-cache-repository";
import { makeFetchFizzyApi } from "../adapters/fetch-fizzy-api";

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
const CONFIG_FILE = ".fizzy.yaml";

type StandardizedCommentKind = "done" | "blocked" | "unblocked" | "handoff" | "note";

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const standardizedCommentTemplate = (
	language: FlowCardLanguage,
	kind: StandardizedCommentKind,
): string => {
	if (language === "en") {
		return {
			done: "done: ",
			blocked: "blocked: ",
			unblocked: "unblocked: ",
			handoff: "handoff: ",
			note: "note: ",
		}[kind];
	}

	return {
		done: "完成：",
		blocked: "阻塞：",
		unblocked: "已解锁：",
		handoff: "交接：",
		note: "备注：",
	}[kind];
};

export const buildStandardizedCommentBody = (
	language: FlowCardLanguage,
	kind: StandardizedCommentKind,
	value: string,
): string => `<p>${standardizedCommentTemplate(language, kind)}${escapeHtml(value)}</p>`;

export const getStandardizedCommentTemplate = (
	language: FlowCardLanguage,
	kind: StandardizedCommentKind,
): string => {
	if (kind === "done") {
		return language === "en" ? `done: commit <sha>: <subject>` : `完成：commit <sha>: <subject>`;
	}

	if (kind === "blocked") {
		return language === "en"
			? "blocked: <reason; owner/decision needed>"
			: "阻塞：<原因；需要谁/什么决策>";
	}

	if (kind === "unblocked") {
		return language === "en" ? "unblocked: <resource/decision ready>" : "已解锁：<资源/决策已就绪>";
	}

	if (kind === "handoff") {
		return language === "en" ? "handoff: <current state; next step>" : "交接：<当前状态；下一步>";
	}

	return language === "en" ? "note: <brief note>" : "备注：<简短说明>";
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
	message.startsWith(`No ${CONFIG_FILE} found from`);

const isTaggedError = (error: unknown, tag: string): error is { _tag: string } =>
	typeof error === "object" &&
	error !== null &&
	"_tag" in error &&
	(error as { _tag: unknown })._tag === tag;

const isTaggedErrorWithMessage = (
	error: unknown,
	tag: string,
): error is { _tag: string; message: string } =>
	isTaggedError(error, tag) && typeof (error as { message?: unknown }).message === "string";

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
		selfAssignCard: (number) => withAuthRetry((api) => api.selfAssignCard(number)),
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
		const [identity, cards, notNow] = yield* Effect.all([
			env.api.identity(),
			env.api.listCards({ all: true }),
			env.api.listCards({ indexedBy: "not_now", all: true }),
		]);
		const users = buildUsers(env.config, cards);
		const cache: BoardCache = {
			identity,
			cards,
			notNow,
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
		const userId = options.user ? resolveUser(env.config, options.user) : cache.identity.userId;
		const name = findUserName(cache, userId) || options.user || cache.identity.name || "me";
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
		const card = result.cards.find((item) => (item.column?.name || "") === "TODO");
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
			yield* env.api.selfAssignCard(number);
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

		const columns = yield* env.api.listColumns();
		const doneColumnId = yield* ensureColumn(columns, "DONE", () => env.api.createColumn("DONE"));
		yield* env.api.moveCard(number, doneColumnId);

		const finalRef = ref || "done";
		yield* env.api.comment(
			number,
			buildStandardizedCommentBody(env.config.flow.card.language, "done", finalRef),
		);
		yield* env.api.closeCard(number);
		yield* syncBoard(env);
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
		const language = env.config.flow.card.language;
		yield* env.api.comment(number, buildStandardizedCommentBody(language, "blocked", reason));
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
		const existing = new Set((card.steps || []).map((step) => step.content));
		const parsed = parseDoneWhen(card.description || "");
		const unique = new Set<string>();
		const steps = parsed.filter((step) => {
			if (existing.has(step.content) || unique.has(step.content)) {
				return false;
			}
			unique.add(step.content);
			return true;
		});
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
		return yield* standardizeLoadedCard(env, card);
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

const standardizeLoadedCard = (env: InitializedEnv, card: Card) =>
	Effect.gen(function* () {
		const source = card.descriptionHtml || card.description || "";
		const plain = markdownishText(source);
		const sections = parseDescriptionSections(plain);
		const nextMarkdown = buildStandardDescription(env.config.flow.card.language, card, sections);
		const nextDescription = convertDescription(nextMarkdown);
		const currentDescription = card.descriptionHtml || card.description || "";
		const descriptionUpdated =
			normalizeComparableDescription(nextDescription) !==
			normalizeComparableDescription(currentDescription);

		if (descriptionUpdated) {
			yield* env.api.updateCardDescription(card.number, nextDescription);
		}

		const existingSteps = card.steps || [];
		const existingByContent = new Map<string, Step>();
		for (const step of existingSteps) {
			existingByContent.set(normalizeStepContent(step.content), step);
		}

		const oldStepCandidates =
			existingSteps.length > 0 ? [] : extractStandardizeSteps(source, sections);
		let stepsCreated = 0;
		let stepsUpdated = 0;
		let stepsCompleted = 0;

		for (const step of existingSteps) {
			const normalized = normalizeStepContent(step.content);
			const needsContentUpdate = Boolean(step.id) && normalized !== step.content;
			const needsCompletion = Boolean(step.id) && Boolean(card.closed) && !step.completed;
			if (!step.id || (!needsContentUpdate && !needsCompletion)) continue;

			yield* env.api.updateStep(card.number, step.id, {
				...(needsContentUpdate ? { content: normalized } : {}),
				...(needsCompletion ? { completed: true } : {}),
			});
			if (needsContentUpdate) stepsUpdated += 1;
			if (needsCompletion) stepsCompleted += 1;
		}

		for (const candidate of oldStepCandidates) {
			const content = normalizeStepContent(candidate.content);
			if (!content || existingByContent.has(content)) continue;
			yield* env.api.createStep(card.number, content, Boolean(card.closed) || candidate.completed);
			stepsCreated += 1;
			existingByContent.set(content, {
				content,
				completed: Boolean(card.closed) || candidate.completed,
			});
		}

		return {
			number: card.number,
			descriptionUpdated,
			stepsCreated,
			stepsUpdated,
			stepsCompleted,
		} satisfies StandardizeCardResult;
	});

const ensureFlowConfig = (args: {
	configRepo: ConfigRepository;
	api: FizzyApi;
	config: ProjectConfig;
	initialUsers?: Record<string, string>;
}): Effect.Effect<InitializedProjectConfig, unknown> =>
	Effect.gen(function* () {
		const existingUsers: Record<string, string> = {
			...args.initialUsers,
		};
		if (args.config.flow?.users) {
			Object.assign(existingUsers, args.config.flow.users);
		}

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
		const usersFromCards = buildUsers(args.config, cards);
		Object.assign(existingUsers, usersFromCards);

		if (identityResult._tag === "success" && identityResult.identity.name) {
			existingUsers[identityResult.identity.name] = identityResult.identity.userId;
		}

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

		console.error("flow config missing; initializing...");
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

const buildUsers = (config: ProjectConfig, cards: ReadonlyArray<Card>): Record<string, string> => {
	const users = { ...config.flow?.users };
	for (const card of cards) {
		for (const assignee of card.assignees || []) {
			if (assignee.name) users[assignee.name] = assignee.id;
		}
	}
	return users;
};

export const resolveUser = (config: InitializedProjectConfig, user: string): string => {
	const exact = config.flow.users[user];
	if (exact) return exact;
	const lower = config.flow.users[user.toLowerCase()];
	if (lower) return lower;
	if (/^03[a-z0-9]{23}$/.test(user)) return user;
	throw new ValidationError({ message: `Unknown user ${user}` });
};

const resolveBoardUser = (boardUsers: Record<string, string>, user: string): string => {
	const exact = boardUsers[user];
	if (exact) return exact;
	const lower = boardUsers[user.toLowerCase()];
	if (lower) return lower;
	if (/^03[a-z0-9]{23}$/.test(user)) {
		const knownIds = Object.values(boardUsers);
		if (!knownIds.includes(user)) {
			const members = Object.keys(boardUsers).join(", ");
			throw new ValidationError({
				message: `User ID ${user} is not a board member. Known members: ${members}`,
			});
		}
		return user;
	}
	const members = Object.keys(boardUsers).join(", ");
	throw new ValidationError({ message: `Unknown user "${user}". Board members: ${members}` });
};

export const assign = (env: InitializedEnv, number: number, users: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		if (users.length === 0)
			return yield* new ValidationError({ message: "At least one user is required" });
		const cache = yield* ensureCache(env, false);
		const boardUsers = { ...cache.users };
		const userIds = users.map((u) => resolveBoardUser(boardUsers, u));
		yield* Effect.forEach(userIds, (userId) => env.api.assignCard(number, userId), {
			concurrency: 1,
		});
		yield* syncBoard(env);
		return { number, userIds };
	});

const findUserName = (cache: BoardCache, userId: string): string | undefined =>
	Object.entries(cache.users).find(([, id]) => id === userId)?.[0];

const parseDoneWhen = (description: string): Array<{ content: string; completed: boolean }> =>
	parseMarkdownTaskList(description)
		.concat(parseHtmlTaskList(description))
		.filter(
			(step, index, array) => array.findIndex((next) => next.content === step.content) === index,
		);

const normalizeStepContent = (value: string): string => {
	return decodeTextEntities(
		value
			.replace(/`([^`]+)`/g, "$1")
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/~~([^~]+)~~/g, "$1")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.trim(),
	);
};

const stripTaskListHtmlText = (value: string): string =>
	value
		.replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')/gi, (_, d1, d2) => d1 ?? d2 ?? "")
		.replace(/<img\b[^>]*>/gi, "")
		.replace(/<input[^>]*>/gi, " ")
		.replace(/<[^>]*>/g, "");

const parseTemplateDescription = (
	description: string,
): {
	cardDescription: string;
	templateSteps: Array<{ content: string; completed: boolean }>;
} => {
	const lines = description.split(/\r?\n/);
	const cardLines: string[] = [];
	const templateLines: string[] = [];
	let inTemplate = false;
	let sawTemplate = false;

	for (const line of lines) {
		if (!inTemplate && /^##\s+Steps\s*$/i.test(line)) {
			inTemplate = true;
			sawTemplate = true;
			continue;
		}

		if (inTemplate && /^##\s+/.test(line)) {
			inTemplate = false;
		}

		if (inTemplate) {
			templateLines.push(line);
		} else {
			cardLines.push(line);
		}
	}

	if (!sawTemplate) {
		return {
			cardDescription: description,
			templateSteps: [],
		};
	}

	return {
		cardDescription: cardLines.join("\n"),
		templateSteps: parseDoneWhen(templateLines.join("\n")),
	};
};

type DescriptionSections = Record<string, string[]>;

const markdownishText = (value: string): string =>
	decodeTextEntities(
		value
			.replace(
				/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
				(_, text: string) => `\n## ${stripTaskListHtmlText(text).trim()}\n`,
			)
			.replace(
				/<li[^>]*>([\s\S]*?)<\/li>/gi,
				(_, text: string) => `\n- ${stripTaskListHtmlText(text).trim()}`,
			)
			.replace(
				/<p[^>]*>([\s\S]*?)<\/p>/gi,
				(_, text: string) => `\n${stripTaskListHtmlText(text).trim()}\n`,
			)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]*>/g, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);

const parseDescriptionSections = (value: string): DescriptionSections => {
	const sections: DescriptionSections = {};
	let current = "root";
	for (const rawLine of value.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		if (heading?.[1]) {
			current = normalizeHeading(heading[1]);
			sections[current] ||= [];
			continue;
		}
		sections[current] ||= [];
		sections[current]!.push(line);
	}
	return sections;
};

const normalizeHeading = (value: string): string =>
	normalizeStepContent(value)
		.toLowerCase()
		.replace(/[：:]+$/, "")
		.trim();

const firstSection = (sections: DescriptionSections, names: ReadonlyArray<string>): string => {
	for (const name of names) {
		const lines = sections[name];
		if (!lines) continue;
		const text = cleanSectionLines(lines).join("\n").trim();
		if (text) return text;
	}
	return "";
};

const cleanSectionLines = (lines: ReadonlyArray<string>): string[] =>
	lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^[-*]\s+/, "- "));

const buildStandardDescription = (
	language: FlowCardLanguage,
	card: Card,
	sections: DescriptionSections,
): string => {
	const labels =
		language === "en"
			? { goal: "Goal", files: "Files", verification: "Verification", notes: "Notes" }
			: { goal: "目标", files: "文件", verification: "验证", notes: "备注" };
	const goal = firstSection(sections, ["goal", "目标"]) || card.title;
	const files = firstSection(sections, ["files", "文件"]);
	const verification = mergeUniqueLines(
		firstSection(sections, ["verification", "验证"])
			.split(/\r?\n/)
			.concat(extractVerificationLines(firstSection(sections, ["done when", "完成条件"]))),
	);
	const notes = firstSection(sections, ["notes", "备注"]);

	const parts = [`## ${labels.goal}`, "", goal.trim()];
	if (files) parts.push("", `## ${labels.files}`, "", files);
	if (verification.length > 0) parts.push("", `## ${labels.verification}`, "", ...verification);
	if (notes) parts.push("", `## ${labels.notes}`, "", notes);
	return parts.join("\n").trim();
};

const mergeUniqueLines = (lines: ReadonlyArray<string>): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || seen.has(line)) continue;
		seen.add(line);
		result.push(line.startsWith("-") ? line : `- ${line}`);
	}
	return result;
};

const extractVerificationLines = (doneWhen: string): string[] =>
	doneWhen
		.split(/\r?\n/)
		.map((line) => normalizeStepContent(line.replace(/^[-*]\s+(\[[ xX]\]\s*)?/, "")))
		.filter((line) =>
			/\b(pnpm|bun|test|check|build|screenshot|compare|lint|typecheck)\b/i.test(line),
		)
		.map((line) => `- ${line}`);

const extractStandardizeSteps = (
	source: string,
	sections: DescriptionSections,
): Array<{ content: string; completed: boolean }> => {
	const doneWhen = firstSection(sections, ["done when", "完成条件"]);
	const parsed = parseDoneWhen(source).concat(parseLooseStepLines(doneWhen));
	const seen = new Set<string>();
	return parsed.filter((step) => {
		const content = normalizeStepContent(step.content);
		if (!content || seen.has(content)) return false;
		seen.add(content);
		step.content = content;
		return true;
	});
};

const parseLooseStepLines = (value: string): Array<{ content: string; completed: boolean }> =>
	value.split(/\r?\n/).flatMap((line) => {
		const match = line.match(/^\s*[-*]\s+(?:\[([ xX])]\s*)?(.+)$/);
		if (!match?.[2]) return [];
		return [
			{ content: normalizeStepContent(match[2]), completed: match[1]?.toLowerCase() === "x" },
		];
	});

const normalizeComparableDescription = (value: string): string =>
	markdownishText(value).replace(/\s+/g, " ").trim();

const parseMarkdownTaskList = (description: string) =>
	description.split(/\r?\n/).flatMap((line) => {
		const match = line.match(/^\s*-\s*\[([ xX])]\s*(.+)$/);
		if (!match) return [];
		const content = normalizeStepContent(match[2]!.trim());
		if (!content) return [];
		return [{ content, completed: match[1]!.toLowerCase() === "x" }];
	});

const parseHtmlTaskList = (description: string): Array<{ content: string; completed: boolean }> => {
	const matches = description.matchAll(
		/<li[^>]*class=["'][^"']*task-list-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
	);

	const steps: Array<{ content: string; completed: boolean }> = [];
	for (const match of matches) {
		const html = match[1] || "";
		const completed = /<input[^>]*\bchecked\b[^>]*>/i.test(html);
		const text = normalizeStepContent(stripTaskListHtmlText(html));
		if (!text) continue;
		steps.push({ content: text, completed });
	}

	return steps;
};

const htmlEntityMap: Record<string, string> = {
	apos: "'",
	amp: "&",
	copy: "©",
	gt: ">",
	lt: "<",
	ldquo: "“",
	rdquo: "”",
	reg: "®",
	quot: '"',
	nbsp: " ",
	trade: "™",
	hellip: "…",
	ndash: "–",
	mdash: "—",
};

const decodeTextEntities = (value: string): string =>
	value
		.replace(/&([a-zA-Z]+);/g, (match, name) => {
			if (!name) return match;
			const entity =
				name in htmlEntityMap ? htmlEntityMap[name as keyof typeof htmlEntityMap] : undefined;
			return entity ?? match;
		})
		.replace(/&#x([0-9A-Fa-f]+);/g, (match, hexCode: string | undefined) => {
			if (!hexCode) return match;
			const code = Number.parseInt(hexCode, 16);
			if (Number.isNaN(code)) return match;
			return String.fromCodePoint(code);
		})
		.replace(/&#(\d+);/g, (match, decimal: string | undefined) => {
			if (!decimal) return match;
			const code = Number.parseInt(decimal, 10);
			if (Number.isNaN(code)) return match;
			return String.fromCodePoint(code);
		});

const richTextSignature =
	/(<[^>]+>|`|^#{1,6}\s+.+|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|!\[[^\]]*\]\([^)]+\)|~~[^~]+~~|\b_[^_]+_\b|^\s{0,3}[-+*]\s+\[[ xX]\]|^\s{0,3}\d+\.\s+|^\s{0,3}>\s+|^```)/m;

export const convertDescription = (input: string): string =>
	richTextSignature.test(input) ? Bun.markdown.html(input) : input;

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
