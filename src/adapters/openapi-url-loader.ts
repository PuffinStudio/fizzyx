import { Effect } from "effect";
import type { OpenApiLoader } from "../ports/openapi-loader";
import { SpecLoadError, SpecParseError } from "../domain/errors";
import { parseSpec } from "../use-cases/openapi-parser";

function parseSpecResponseAsDoc(
	text: string,
	contentType?: string | null,
): Record<string, unknown> {
	const normalized = (contentType || "").toLowerCase();
	const isYaml = normalized.includes("yaml") || normalized.includes("yml");

	if (isYaml) {
		return Bun.YAML.parse(text) as Record<string, unknown>;
	}

	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch (jsonError) {
		try {
			return Bun.YAML.parse(text) as Record<string, unknown>;
		} catch (yamlError) {
			throw new Error(
				`neither JSON nor YAML (${contentType ?? "content-type unknown"}): ${jsonError instanceof Error ? jsonError.message : String(jsonError)} / ${yamlError instanceof Error ? yamlError.message : String(yamlError)}`,
			);
		}
	}
}

export const openapiUrlLoader: OpenApiLoader = {
	load: (input: string, headers?: Record<string, string>) =>
		Effect.gen(function* () {
			let text: string;
			let contentType: string | null = null;
			try {
				const init: RequestInit = {};
				if (headers && Object.keys(headers).length > 0) {
					init.headers = headers;
				}
				const response = yield* Effect.tryPromise({
					try: () => fetch(input, init),
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

				contentType = response.headers.get("content-type");

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
				doc = parseSpecResponseAsDoc(text, contentType);
			} catch (e) {
				return yield* Effect.fail(
					new SpecParseError({
						message: "cannot parse spec response as JSON or YAML",
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
