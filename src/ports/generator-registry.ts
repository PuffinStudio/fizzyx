import { Context, type Effect } from "effect";
import type { CodeGenerator } from "./code-generator";
import type { OpenApiLoader } from "./openapi-loader";
import type { KnownGenerator } from "../domain/openapi-models";

export interface GeneratorRegistry {
	readonly getGenerator: (name: string) => Effect.Effect<CodeGenerator, Error>;
	readonly getLoader: (url: string) => OpenApiLoader;
	readonly listGenerators: () => KnownGenerator[];
}

export const GeneratorRegistry = Context.Service<GeneratorRegistry>("GeneratorRegistry");
