import { Effect } from "effect";
import { readGitCommandOutput } from "./flow-git";
import { AuthError, ValidationError } from "../domain/errors";
import type { BoardCache, Card, ProjectConfig, Step } from "../domain/models";
import type { SetupProjectConfigInput } from "../ports/config-repository";
import { ConfigRepo, CONFIG_FILE } from "../ports/config-repository";
import { ensureFlowConfig } from "./flow-bootstrap";
import {
	convertDescription,
	parseTemplateDescription,
	planStandardizeCardContent,
	planStepsFromDescription,
} from "./flow-card-content";
import {
	buildBoardUsers,
	isCurrentUserAlias,
	resolveAssignableUser,
	resolveMineUser,
	resolveUser,
} from "./flow-user-resolution";
import { makeFlowApiWithAuthRetry } from "./flow-auth";
import { buildStandardizedCommentBody, getStandardizedCommentTemplate } from "./flow-comment";
import {
	makeEnv,
	makeFlowEnv,
	makeFlowRuntimeEnv,
	bootstrapFlowConfig,
	DEFAULT_ACCOUNT,
	DEFAULT_API_URL,
	loadConfigOrDefaults,
} from "./flow-env";
import type { Env, InitializedEnv } from "./flow-env";
import {
	READY_COLUMN_ALIASES,
	REVIEW_COLUMN_ALIASES,
	isInProgressColumn,
	isReadyColumn,
	isReviewColumn,
	isTodoColumn,
	moveToWorkflowColumn,
	resolveInProgressColumnId,
	resolveReadyColumnId,
	resolveTodoColumnId,
} from "./flow-workflow";
import { analyzeDoctor, repairDoctor, type DoctorResult } from "./flow-doctor";
import type { PlannerMetadata } from "./planner-metadata";
import { parsePlannerDescription } from "./planner-metadata";
import { normalizePriority } from "./planner-transform";
export { convertDescription } from "./flow-card-content";
export { resolveUser } from "./flow-user-resolution";

export type { Env, InitializedEnv };
export { makeEnv, makeFlowEnv, makeFlowRuntimeEnv, bootstrapFlowConfig };
export { analyzeDoctor, repairDoctor, type DoctorResult };
export { buildStandardizedCommentBody, getStandardizedCommentTemplate };

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
		const api = makeFlowApiWithAuthRetry({
			configRepo,
			config: defaults,
			initialToken: credentials.token,
		});

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
		const api = makeFlowApiWithAuthRetry({
			configRepo,
			config,
			initialToken: credentials.token,
		});
		return yield* api.listBoards();
	});

// Auth retry policy moved to flow-auth.ts

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

	const api = makeFlowApiWithAuthRetry({
		configRepo,
		config,
		initialToken: credentials.value.token,
	});
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
		const cards = cache.cards.filter(
			(card) =>
				Boolean(card.column?.name) && card.assignees?.some((assignee) => assignee.id === userId),
		);
		return { name, userId, cards };
	});

export const status = (env: InitializedEnv, options: { fresh: boolean }) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, options.fresh);
		const age = yield* env.cacheRepo.ageSeconds();
		return { cache, age };
	});

export const show = (env: Env, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		if (!card.column?.name) {
			return yield* new ValidationError({
				message: `Card #${number} is not in a workflow column. It is probably still in Fizzy system MAYBE/triage.`,
			});
		}
		const comments = yield* env.api
			.listComments(number)
			.pipe(Effect.catch(() => Effect.succeed([])));
		return { card, comments: comments.slice(-3) };
	});

export const next = (env: InitializedEnv, options: { fresh: boolean }) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, options.fresh);
		const result = (() => {
			const user = resolveMineUser(env.config, cache);
			const cards = cache.cards.filter((card) =>
				card.assignees?.some((assignee) => assignee.id === user.userId),
			);
			return { ...user, cards };
		})();
		const readyColumnId = resolveReadyColumnId(cache.columns, env.config.flow.columns.todo);
		const readyCard = readyColumnId
			? result.cards.find(
					(item) => item.column?.id === readyColumnId || isReadyColumn(item.column?.name),
				)
			: undefined;
		if (readyCard) {
			return { user: result, card: readyCard };
		}

		const todoColumnId = resolveTodoColumnId(cache.columns, env.config.flow.columns.todo);
		const card = result.cards.find(
			(item) => item.column?.id === todoColumnId || isTodoColumn(item.column?.name),
		);
		return { user: result, card };
	});

export interface NextOrStartResult {
	user: {
		name: string;
		userId: string;
	};
	card?: Card;
	started: boolean;
}

export const nextOrStart = (env: InitializedEnv, options: { fresh: boolean; autoStart: boolean }) =>
	Effect.gen(function* () {
		const result = yield* next(env, options);
		if (!options.autoStart || !result.card) {
			return { ...result, started: false };
		}

		const cardNumber = result.card.number;
		yield* start(env, cardNumber);
		const card = yield* env.api.showCard(cardNumber);
		return {
			...result,
			card,
			started: true,
		};
	});

export const start = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const cache = yield* ensureCache(env, true);
		const inProgressColumnId = resolveInProgressColumnId(
			cache.columns,
			env.config.flow.columns.inProgress,
		);
		const target = cache.cards.find((card) => card.number === number);
		if (!target) return yield* new ValidationError({ message: `Card #${number} not found` });
		const userId = cache.identity.userId;
		const active = cache.cards.filter(
			(card) =>
				(card.column?.id === inProgressColumnId || isInProgressColumn(card.column?.name)) &&
				card.assignees?.some((assignee) => assignee.id === userId),
		);
		if (active.length >= env.config.flow.wipLimit) {
			return yield* new ValidationError({
				message: `Current user already has ${active.length} INPROGRESS cards`,
			});
		}
		const startColumnId = inProgressColumnId;
		yield* env.api.moveCard(number, startColumnId);
		yield* verifyCardColumn(env, number, startColumnId, isInProgressColumn, "IN PROGRESS");
		if (!target.assignees?.some((assignee) => assignee.id === userId)) {
			yield* env.api.assignCard(number, userId);
		}
		yield* syncBoard(env);
		return number;
	});

export const ready = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const result = yield* moveToWorkflowColumn(
			{
				listColumns: env.api.listColumns,
				moveCard: env.api.moveCard,
			},
			number,
			READY_COLUMN_ALIASES,
			"READY",
			() => syncBoard(env).pipe(Effect.catch(() => Effect.succeed(undefined))),
		);
		yield* verifyCardColumn(env, number, undefined, isReadyColumn, "READY");
		return result;
	});

export const review = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const result = yield* moveToWorkflowColumn(
			{
				listColumns: env.api.listColumns,
				moveCard: env.api.moveCard,
			},
			number,
			REVIEW_COLUMN_ALIASES,
			"REVIEW",
			() => syncBoard(env).pipe(Effect.catch(() => Effect.succeed(undefined))),
		);
		yield* verifyCardColumn(env, number, undefined, isReviewColumn, "REVIEW");
		return result;
	});

const completePendingStepsForCard = (
	env: InitializedEnv,
	number: number,
	card: { steps?: ReadonlyArray<Step> },
) =>
	Effect.gen(function* () {
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

		return {
			updatedCount: toComplete.length,
			contents: toComplete.map((step) => step.content),
		};
	});

export const done = (
	env: InitializedEnv,
	number: number,
	ref?: string,
	options?: { completeSteps?: boolean },
) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const unfinished = (card.steps || []).filter((step) => !step.completed);
		let completedSteps:
			| {
					updatedCount: number;
					contents: ReadonlyArray<string>;
			  }
			| undefined;
		if (unfinished.length > 0 && options?.completeSteps) {
			completedSteps = yield* completePendingStepsForCard(env, number, card);
		} else if (unfinished.length > 0) {
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
		return completedSteps ? { number, ref: finalRef, completedSteps } : { number, ref: finalRef };
	});

export const resolveDoneRefFromGit = (options: { cwd?: string } = {}) =>
	Effect.gen(function* () {
		const cwd = options.cwd || process.cwd();
		const status = yield* readGitCommandOutput(cwd, ["status", "--porcelain"]);
		if (status !== "") {
			return yield* new ValidationError({
				message:
					"Cannot auto-detect done ref with uncommitted changes. Commit first or pass an explicit ref.",
			});
		}

		const [short, subject] = yield* Effect.all([
			readGitCommandOutput(cwd, ["rev-parse", "--short", "HEAD"]),
			readGitCommandOutput(cwd, ["log", "-1", "--format=%s"]),
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
		const metadata = parsePlannerDescription(parsed.cardDescription).metadata;
		const tags = mergeTags(
			parsed.templateTags.filter((tag) => !tag.trim().toLowerCase().startsWith("api_status:")),
			tagsFromMetadata(metadata),
		);
		const userId = isCurrentUserAlias(input.user)
			? resolveAssignableUser(yield* ensureCache(env, false), input.user)
			: resolveUser(env.config, input.user);
		const columns = yield* env.api.listColumns();
		const todoColumnId = resolveTodoColumnId(columns, env.config.flow.columns.todo);
		const card = yield* env.api.createCard({
			title: input.title,
			description: convertDescription(parsed.cardDescription),
			board: env.config.board,
		});
		yield* env.api.triageCard(card.number, todoColumnId);
		yield* env.api.assignCard(card.number, userId);
		yield* Effect.forEach(tags, (tag) => env.api.tagCard(card.number, tag));
		yield* verifyCardColumn(env, card.number, todoColumnId, isTodoColumn, "TODO");
		yield* Effect.forEach(parsed.templateSteps, (step) =>
			env.api.createStep(card.number, step.content, step.completed),
		);
		yield* syncBoard(env);
		return card.number;
	});

const tagsFromMetadata = (metadata: PlannerMetadata): ReadonlyArray<string> => {
	const tags: string[] = [];
	const priority = normalizePriority(metadata.priority);
	if (priority) tags.push(`priority:${priority}`);
	if (metadata.type) tags.push(`type:${metadata.type.toLowerCase()}`);
	if (metadata.phase) tags.push(`phase:${metadata.phase.toLowerCase()}`);
	for (const dependency of metadata.depends_on) tags.push(`depends_on:${dependency}`);
	for (const blocked of metadata.blocks) tags.push(`blocks:${blocked}`);
	return tags;
};

const mergeTags = (...groups: ReadonlyArray<ReadonlyArray<string>>): ReadonlyArray<string> =>
	Array.from(
		new Set(
			groups
				.flat()
				.map((tag) => tag.trim().toLowerCase())
				.filter(Boolean),
		),
	);

export const repairMarkdownDescription = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const original = card.descriptionHtml || card.description || "";
		const description = convertDescription(original);
		if (description !== original) {
			yield* env.api.updateCardDescription(number, description);
		}
		yield* syncBoard(env);
		return number;
	});

export const completeSteps = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const completedSteps = yield* completePendingStepsForCard(env, number, card);
		yield* syncBoard(env);
		return { number, ...completedSteps };
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

		const results = yield* Effect.forEach(cards, (card) => standardizeCard(env, card.number), {
			concurrency: 8,
		});
		return {
			results,
			total: results.length,
			descriptionUpdated: results.filter((result) => result.descriptionUpdated).length,
			stepsCreated: results.reduce((total, result) => total + result.stepsCreated, 0),
			stepsUpdated: results.reduce((total, result) => total + result.stepsUpdated, 0),
			stepsCompleted: results.reduce((total, result) => total + result.stepsCompleted, 0),
		};
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

const verifyCardColumn = (
	env: InitializedEnv,
	number: number,
	expectedColumnId: string | undefined,
	matchesExpectedName: (name?: string) => boolean,
	label: string,
) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const column = card.column;
		if (
			column &&
			((expectedColumnId && column.id === expectedColumnId) || matchesExpectedName(column.name))
		) {
			return card;
		}

		return yield* new ValidationError({
			message: `Card #${number} is not in ${label}. Fizzy returned no matching workflow column after the move.`,
		});
	});
