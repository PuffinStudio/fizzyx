import { Effect } from "effect";
import type { InitializedEnv, Env } from "../use-cases/flow-service";
import { makeFlowEnv, makeFlowRuntimeEnv } from "../use-cases/flow-service";
import { withSpinner } from "./ui";

export const runWithFlowEnv = <A>(
	message: string,
	run: (env: InitializedEnv) => Effect.Effect<A, any, any>,
): Effect.Effect<A, any, any> =>
	withSpinner(
		message,
		Effect.gen(function* () {
			const env = yield* makeFlowEnv;
			return yield* run(env);
		}),
	);

export const runWithFlowRuntimeEnv = <A>(
	message: string,
	run: (env: Env) => Effect.Effect<A, any, any>,
): Effect.Effect<A, any, any> =>
	withSpinner(
		message,
		Effect.gen(function* () {
			const env = yield* makeFlowRuntimeEnv;
			return yield* run(env);
		}),
	);
