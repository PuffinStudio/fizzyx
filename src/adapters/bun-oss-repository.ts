import { S3Client } from "bun";
import { Effect } from "effect";
import { OssError } from "../domain/errors";
import type { OssEnvironmentConfig } from "../domain/models";
import type { OssRepository } from "../ports/oss-repository";

const toOssError = (cause: unknown, key?: string): OssError =>
	cause instanceof OssError
		? cause
		: new OssError({
				message: String(cause),
				key,
				status: isS3Error(cause) ? (cause as { status?: number }).status : undefined,
			});

const isS3Error = (error: unknown): boolean =>
	typeof error === "object" && error !== null && (error as { name?: unknown }).name === "S3Error";

export const makeBunOssRepository = (env: OssEnvironmentConfig): OssRepository => {
	const client = new S3Client({
		accessKeyId: env.accessKeyId,
		secretAccessKey: env.secretAccessKey,
		endpoint: env.endpoint,
		bucket: env.bucket,
		region: env.region,
	});

	return {
		write: (key, body) =>
			Effect.tryPromise({
				try: () => client.write(key, body).then(() => undefined),
				catch: (cause) => toOssError(cause, key),
			}),

		exists: (key) =>
			Effect.tryPromise({
				try: () => client.exists(key),
				catch: (cause) => toOssError(cause, key),
			}),

		delete: (key) =>
			Effect.tryPromise({
				try: () => client.delete(key),
				catch: (cause) => toOssError(cause, key),
			}),
	};
};
