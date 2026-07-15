import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
	message: string;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
	message: string;
}> {}

export class ApiError extends Data.TaggedError("ApiError")<{
	message: string;
	status?: number;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
	message: string;
}> {}

export class FileError extends Data.TaggedError("FileError")<{
	message: string;
	path?: string;
}> {}

export class OssError extends Data.TaggedError("OssError")<{
	message: string;
	key?: string;
	status?: number;
}> {}

export class SpecLoadError extends Data.TaggedError("SpecLoadError")<{
	message: string;
	source: string;
	cause?: unknown;
}> {}

export class SpecParseError extends Data.TaggedError("SpecParseError")<{
	message: string;
	cause?: unknown;
}> {}

export class CodegenError extends Data.TaggedError("CodegenError")<{
	message: string;
	target?: string;
	cause?: unknown;
}> {}

export class AdminGenerationError extends Data.TaggedError("AdminGenerationError")<{
	message: string;
	command?: string[];
	stderr?: string;
	cause?: unknown;
}> {}

export class ConfigValidationError extends Data.TaggedError("ConfigValidationError")<{
	message: string;
	field?: string;
}> {}

export type FizzyxError =
	| ConfigError
	| AuthError
	| ApiError
	| ValidationError
	| FileError
	| OssError
	| SpecLoadError
	| SpecParseError
	| CodegenError
	| AdminGenerationError
	| ConfigValidationError;
