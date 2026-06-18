import { Context, type Effect } from "effect";
import type { OssError } from "../domain/errors";

export interface OssRepository {
	write: (key: string, body: Blob | string) => Effect.Effect<void, OssError>;
	exists: (key: string) => Effect.Effect<boolean, OssError>;
	delete: (key: string) => Effect.Effect<void, OssError>;
}

export const OssRepo = Context.Service<OssRepository>("OssRepo");
