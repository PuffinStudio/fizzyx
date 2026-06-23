import type { Effect } from "effect";
import type { CodegenError } from "../domain/errors";
import type {
	GenFileOptions,
	GeneratedFile,
	KnownGenerator,
	ParsedSpec,
} from "../domain/openapi-models";

export interface CodeGenerator {
	readonly name: string;
	readonly info: KnownGenerator;
	generate: (
		spec: ParsedSpec,
		output: string,
		options?: GenFileOptions,
	) => Effect.Effect<GeneratedFile[], CodegenError>;
}

export interface CodeExtensionGenerator {
	readonly name: string;
	readonly info: KnownGenerator;
	readonly exportPath: string;
	generate: (
		spec: ParsedSpec,
		output: string,
		options?: GenFileOptions,
	) => Effect.Effect<GeneratedFile[], CodegenError>;
}
