import { Effect } from "effect";
import type { OpenApiLoader } from "../ports/openapi-loader";
import { SpecLoadError, SpecParseError } from "../domain/errors";
import { parseSpec } from "../use-cases/openapi-parser";

export const openapiFileLoader: OpenApiLoader = {
	load: (input: string, _headers?: Record<string, string>) =>
		Effect.gen(function* () {
			const ext = input.toLowerCase().split(".").pop();

			let raw: string;
			try {
				raw = yield* Effect.tryPromise({
					try: () => Bun.file(input).text(),
					catch: (cause) =>
						new SpecLoadError({
							message: `cannot read file: ${cause instanceof Error ? cause.message : String(cause)}`,
							source: input,
							cause,
						}),
				});
			} catch (e) {
				return yield* Effect.fail(
					e instanceof SpecLoadError
						? e
						: new SpecLoadError({
								message: `failed to read spec file: ${input}`,
								source: input,
							}),
				);
			}

			let doc: Record<string, unknown>;
			try {
				if (ext === "yaml" || ext === "yml") {
					doc = Bun.YAML.parse(raw) as Record<string, unknown>;
				} else {
					doc = JSON.parse(raw) as Record<string, unknown>;
				}
			} catch (e) {
				return yield* Effect.fail(
					new SpecParseError({
						message: `cannot parse spec file as ${ext === "yaml" || ext === "yml" ? "YAML" : "JSON"}`,
						cause: e,
					}),
				);
			}

			try {
				const parsed = yield* Effect.tryPromise({
					try: () => parseSpec(doc),
					catch: (cause) =>
						new SpecParseError({
							message: `cannot process spec: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				});
				return parsed;
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
