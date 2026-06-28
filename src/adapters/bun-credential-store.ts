import { Effect, Layer } from "effect";
import { FileError } from "../domain/errors";
import type { CredentialStore } from "../ports/credential-store";
import { CredentialStoreService } from "../ports/credential-store";

export const BunCredentialStore: CredentialStore = {
	get: (service, account) =>
		Effect.tryPromise({
			try: () => Bun.secrets.get({ service, name: account }),
			catch: (cause) =>
				new FileError({
					message: `Failed to read secret ${service}/${account}: ${String(cause)}`,
					path: `${service}:${account}`,
				}),
		}).pipe(Effect.map((value) => value ?? undefined)),

	set: (service, account, credential) =>
		Effect.tryPromise({
			try: () =>
				Bun.secrets.set({
					service,
					name: account,
					value: credential,
				}),
			catch: (cause) =>
				new FileError({
					message: `Failed to set secret ${service}/${account}: ${String(cause)}`,
					path: `${service}:${account}`,
				}),
		}),

	delete: (service, account) =>
		Effect.tryPromise({
			try: () => Bun.secrets.delete({ service, name: account }),
			catch: (cause) =>
				new FileError({
					message: `Failed to delete secret ${service}/${account}: ${String(cause)}`,
					path: `${service}:${account}`,
				}),
		}),
};

export const BunCredentialStoreLive = Layer.succeed(CredentialStoreService, BunCredentialStore);
