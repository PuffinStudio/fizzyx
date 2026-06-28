import { Effect } from "effect";
import type { InitializedEnv } from "./flow-env";
import { planStandardizeCardContent } from "./flow-card-content";

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
