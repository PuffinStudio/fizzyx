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

export type FizzyxError = ConfigError | AuthError | ApiError | ValidationError | FileError;
