export const isTaggedError = (error: unknown, tag: string): error is { _tag: string } =>
	typeof error === "object" &&
	error !== null &&
	"_tag" in error &&
	(error as { _tag: string })._tag === tag;

export const isTaggedErrorWithMessage = (
	error: unknown,
	tag: string,
): error is { _tag: string; message: string } =>
	isTaggedError(error, tag) && typeof (error as { message?: unknown }).message === "string";
