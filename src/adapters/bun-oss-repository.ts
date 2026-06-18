import { S3Client } from "bun";
import { Effect } from "effect";
import { OssError } from "../domain/errors";
import type { OssEnvironmentConfig, OssListResult } from "../domain/models";
import type { OssRepository, OssListOptions } from "../ports/oss-repository";

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
		...(env.bucket ? { bucket: env.bucket } : {}),
		region: env.region,
		...(env.bucket ? {} : { virtualHostedStyle: true }),
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

		list: (options?: OssListOptions) =>
			Effect.tryPromise({
				try: async () => {
					const result = await client.list(
						options?.prefix || options?.maxKeys || options?.startAfter
							? { prefix: options.prefix, maxKeys: options.maxKeys, startAfter: options.startAfter }
							: null,
					);
					return {
						objects: (result.contents || []).map((item) => ({
							key: item.key,
							eTag: item.eTag,
							lastModified: item.lastModified,
							size: item.size,
						})),
						isTruncated: result.isTruncated ?? false,
					} satisfies OssListResult;
				},
				catch: (cause) => toOssError(cause, options?.prefix),
			}),
	};
};
