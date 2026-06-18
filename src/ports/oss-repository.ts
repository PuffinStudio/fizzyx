import { Context, type Effect } from "effect";
import type { OssError } from "../domain/errors";
import type { OssListResult } from "../domain/models";

export interface OssListOptions {
	prefix?: string;
	maxKeys?: number;
	startAfter?: string;
}

export interface OssRepository {
	write: (key: string, body: Blob | string) => Effect.Effect<void, OssError>;
	exists: (key: string) => Effect.Effect<boolean, OssError>;
	delete: (key: string) => Effect.Effect<void, OssError>;
	list: (options?: OssListOptions) => Effect.Effect<OssListResult, OssError>;
}

export const OssRepo = Context.Service<OssRepository>("OssRepo");
