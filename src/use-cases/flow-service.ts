import { Effect } from "effect";
import { ApiError, AuthError, ConfigError, FileError, ValidationError } from "../domain/errors";
import type {
	BoardCache,
	BoardColumn,
	Card,
	Identity,
	InitializedProjectConfig,
	ProjectConfig,
} from "../domain/models";
import type { CacheRepository } from "../ports/cache-repository";
import type { ConfigRepository, SetupProjectConfigInput } from "../ports/config-repository";
import type { FizzyApi } from "../ports/fizzy-api";
import { makeBunCacheRepository } from "../adapters/bun-cache-repository";
import { makeBunConfigRepository } from "../adapters/bun-config-repository";
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

export const makeEnv = Effect.gen(function* () {
	const configRepo = makeBunConfigRepository();
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
	const configRepo = makeBunConfigRepository();
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
		const configRepo = makeBunConfigRepository();
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
		const configRepo = makeBunConfigRepository();
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
		assignCard: (number, userId) => withAuthRetry((api) => api.assignCard(number, userId)),
		selfAssignCard: (number) => withAuthRetry((api) => api.selfAssignCard(number)),
		moveCard: (number, columnId) => withAuthRetry((api) => api.moveCard(number, columnId)),
		comment: (number, body) => withAuthRetry((api) => api.comment(number, body)),
		closeCard: (number) => withAuthRetry((api) => api.closeCard(number)),
		postponeCard: (number) => withAuthRetry((api) => api.postponeCard(number)),
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
		const configRepo = makeBunConfigRepository();
		const config = yield* loadConfigOrDefaults(configRepo);
		yield* configRepo.saveCredentials(config.account, { token });
		return config.account;
	});

export const authStatus = Effect.gen(function* () {
	const configRepo = makeBunConfigRepository();
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
	const configRepo = makeBunConfigRepository();
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
		const finalRef = ref || "done";
		yield* env.api.comment(number, `<p>✓ Done. ${finalRef}. All Done When satisfied.</p>`);
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
		yield* env.api.comment(number, `<p>Blocked: ${reason}</p>`);
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

		const userId = resolveUser(env.config, input.user);
		const card = yield* env.api.createCard({
			title: input.title,
			description: input.description,
			board: env.config.board,
		});
		yield* env.api.assignCard(card.number, userId);
		yield* env.api.moveCard(card.number, env.config.flow.columns.todo);
		yield* syncBoard(env);
		return card.number;
	});

export const stepsFromDescription = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const existing = new Set((card.steps || []).map((step) => step.content));
		const steps = parseDoneWhen(card.description || "").filter(
			(step) => !existing.has(step.content),
		);
		yield* Effect.forEach(steps, (step) =>
			env.api.createStep(number, step.content, step.completed),
		);
		return steps;
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
		const existing = columns.find((column) => column.name === name);
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

const resolveUser = (config: InitializedProjectConfig, user: string): string => {
	const exact = config.flow.users[user];
	if (exact) return exact;
	const lower = config.flow.users[user.toLowerCase()];
	if (lower) return lower;
	if (/^03[a-z0-9]{23}$/.test(user)) return user;
	throw new ValidationError({ message: `Unknown user ${user}` });
};

const findUserName = (cache: BoardCache, userId: string): string | undefined =>
	Object.entries(cache.users).find(([, id]) => id === userId)?.[0];

const parseDoneWhen = (description: string): Array<{ content: string; completed: boolean }> =>
	description.split(/\r?\n/).flatMap((line) => {
		const match = line.match(/^\s*-\s*\[([ xX])]\s*(.+)$/);
		if (!match) return [];
		return [{ content: match[2]!.trim(), completed: match[1]!.toLowerCase() === "x" }];
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
