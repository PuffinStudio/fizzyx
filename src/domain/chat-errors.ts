export class ChatConnectionError extends Error {
	readonly kind = "ChatConnectionError" as const;
	declare cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "ChatConnectionError";
		this.cause = cause;
	}
}

export class ChatCryptoError extends Error {
	readonly kind = "ChatCryptoError" as const;
	declare cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "ChatCryptoError";
		this.cause = cause;
	}
}

export class ChatStorageError extends Error {
	readonly kind = "ChatStorageError" as const;
	declare cause?: unknown;
	constructor(message: string, cause?: unknown) {
		super(message);
		this.name = "ChatStorageError";
		this.cause = cause;
	}
}

export class ChatValidationError extends Error {
	readonly kind = "ChatValidationError" as const;
	constructor(message: string) {
		super(message);
		this.name = "ChatValidationError";
	}
}

export type ChatError =
	| ChatConnectionError
	| ChatCryptoError
	| ChatStorageError
	| ChatValidationError;
