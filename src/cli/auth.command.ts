import { Effect } from "effect";
import { Command, Argument } from "effect/unstable/cli";
import { authLogin, authLogout, authStatus } from "../use-cases/flow-service";
import {
	formatAuthIdentityError,
	formatAuthLoginMessage,
	formatAuthLogoutMessage,
} from "./auth-output";
import {
	formatCheckingAuthStatusMessage,
	formatClearingCredentialsMessage,
	formatSavingCredentialsMessage,
} from "./auth-output";
import { withSpinner, logSuccess, logKv, logError } from "./ui";

const handleLogin = (config: { token: string }): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const account = yield* withSpinner(formatSavingCredentialsMessage(), authLogin(config.token));
		yield* logSuccess(formatAuthLoginMessage(account));
	});

const handleAuthStatus = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const result = yield* withSpinner(formatCheckingAuthStatusMessage(), authStatus);
		yield* logKv("account", result.account);
		yield* logKv("board", String(result.board));
		yield* logKv("authenticated", String(result.authenticated));
		if (result.identity) {
			yield* logKv("user", String(result.identity.name ?? ""));
			yield* logKv("user_id", String(result.identity.userId));
			yield* logKv("email", String(result.identity.email ?? ""));
		} else if (result.identityError) {
			yield* logError(formatAuthIdentityError(result.identityError));
		}
	});

const handleLogout = (): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const account = yield* withSpinner(formatClearingCredentialsMessage(), authLogout);
		yield* logSuccess(formatAuthLogoutMessage(account));
	});

const authLoginCmd = Command.make(
	"login",
	{
		token: Argument.string("token").pipe(Argument.withDescription("Fizzy API token")),
	},
	handleLogin,
).pipe(Command.withDescription("Save API token for authentication"));

const authStatusCmd = Command.make("status", {}, handleAuthStatus).pipe(
	Command.withDescription("Check authentication status"),
);

const authLogoutCmd = Command.make("logout", {}, handleLogout).pipe(
	Command.withDescription("Remove stored credentials"),
);

export const authCmd = Command.make("auth").pipe(
	Command.withDescription("Manage Fizzy authentication"),
	Command.withSubcommands([authLoginCmd, authStatusCmd, authLogoutCmd]),
);
