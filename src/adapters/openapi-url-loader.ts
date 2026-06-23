import { Effect } from "effect";
import type { OpenApiLoader } from "../ports/openapi-loader";
import { SpecLoadError, SpecParseError } from "../domain/errors";
import { parseSpec } from "./openapi-file-loader";

export const openapiUrlLoader: OpenApiLoader = {
	load: (input: string) =>
		Effect.gen(function* () {
			let text: string;
			try {
				const response = yield* Effect.tryPromise({
					try: () => fetch(input),
					catch: (cause) =>
						new SpecLoadError({
							message: `cannot fetch spec from ${input}: ${cause instanceof Error ? cause.message : String(cause)}`,
							source: input,
							cause,
						}),
				});

				if (!response.ok) {
					return yield* Effect.fail(
						new SpecLoadError({
							message: `HTTP ${response.status} fetching spec from ${input}`,
							source: input,
						}),
					);
				}

				text = yield* Effect.tryPromise({
					try: () => response.text(),
					catch: (cause) =>
						new SpecLoadError({
							message: `cannot read response body from ${input}`,
							source: input,
							cause,
						}),
				});
			} catch (e) {
				return yield* Effect.fail(
					e instanceof SpecLoadError
						? e
						: new SpecLoadError({
								message: `failed to load spec from URL: ${input}`,
								source: input,
							}),
				);
			}

			let doc: Record<string, unknown>;
			try {
				doc = JSON.parse(text) as Record<string, unknown>;
			} catch (e) {
				return yield* Effect.fail(
					new SpecParseError({
						message: "cannot parse spec response as JSON",
						cause: e,
					}),
				);
			}

			try {
				return yield* Effect.tryPromise({
					try: () => parseSpec(doc),
					catch: (cause) =>
						new SpecParseError({
							message: `cannot process spec: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				});
			} catch (e) {
				return yield* Effect.fail(
					e instanceof SpecParseError
						? e
						: new SpecParseError({
								message: "failed to process spec",
								cause: e,
							}),
				);
			}
		}),
};
