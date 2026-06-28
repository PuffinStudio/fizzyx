import { Effect } from "effect";
import { ValidationError } from "../domain/errors";
import type { BoardCache, Step } from "../domain/models";
import type { InitializedEnv } from "./flow-env";
import { planStepsFromDescription } from "./flow-card-content";
import { buildBoardUsers } from "./flow-user-resolution";

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

export const completeSteps = (
	env: InitializedEnv,
	number: number,
	card?: { steps?: ReadonlyArray<Step> },
) =>
	Effect.gen(function* () {
		const sourceCard = card || (yield* env.api.showCard(number));
		const completedSteps = yield* completePendingStepsForCard(env, number, sourceCard);
		yield* syncBoard(env);
		return { number, ...completedSteps };
	});

const syncBoard = (env: InitializedEnv) =>
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

export const stepsFromDescription = (env: InitializedEnv, number: number) =>
	Effect.gen(function* () {
		const card = yield* env.api.showCard(number);
		const steps = planStepsFromDescription(card);
		yield* Effect.forEach(steps, (step) =>
			env.api.createStep(number, step.content, step.completed),
		);
		return steps;
	});
