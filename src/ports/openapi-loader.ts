import type { Effect } from "effect";
import type { SpecLoadError, SpecParseError } from "../domain/errors";
import type { ParsedSpec } from "../domain/openapi-models";

export interface OpenApiLoader {
	load: (
		input: string,
		headers?: Record<string, string>,
	) => Effect.Effect<ParsedSpec, SpecLoadError | SpecParseError>;
}
