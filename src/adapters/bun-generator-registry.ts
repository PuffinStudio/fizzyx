import { Effect, Layer } from "effect";
import type { CodeExtensionGenerator, CodeGenerator } from "../ports/code-generator";
import { GeneratorRegistry } from "../ports/generator-registry";
import { openapiFileLoader } from "./openapi-file-loader";
import { openapiUrlLoader } from "./openapi-url-loader";
import { wxGenerator } from "./codegen-wx";
import { fetchGenerator } from "./codegen-fetch";
import { effectGenerator } from "./codegen-effect";
import { tanstackQueryGenerator } from "./codegen-tanstack-query";

const BUILTIN_GENERATORS: Record<string, CodeGenerator> = {
	wx: wxGenerator,
	fetch: fetchGenerator,
	effect: effectGenerator,
};

const STATE_MANAGEMENT_GENERATORS: Record<string, CodeExtensionGenerator> = {
	"tanstack-query": tanstackQueryGenerator,
};

const isUrl = (input: string): boolean =>
	input.startsWith("http://") || input.startsWith("https://");

const allGenerators = { ...BUILTIN_GENERATORS, ...STATE_MANAGEMENT_GENERATORS };

const formatKnownGenerators = (): string => Object.keys(allGenerators).join(", ");

export const makeBunGeneratorRegistry = (): GeneratorRegistry => ({
	getGenerator: (name: string) => {
		const generator = allGenerators[name];
		if (!generator) {
			return Effect.fail(
				new Error(`unknown generator: ${name}. available: ${formatKnownGenerators()}`),
			);
		}
		return Effect.succeed(generator);
	},

	getLoader: (url: string) => (isUrl(url) ? openapiUrlLoader : openapiFileLoader),

	listGenerators: () => Object.values(BUILTIN_GENERATORS).map((generator) => generator.info),
});

export const GeneratorRegistryLive = Layer.succeed(GeneratorRegistry, makeBunGeneratorRegistry());
