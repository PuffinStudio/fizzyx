import { Console, Effect } from "effect";
import { withSpinner } from "./spinner";
import { authLogin, authLogout, authStatus } from "../use-cases/flow-service";
import { isHelpCommand, hasHelp } from "./_shared/help";

export const runAuth = (args: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const [command = "help", ...rest] = args;

		if (isHelpCommand(command)) {
			yield* Console.log(authUsage());
			return;
		}

		switch (command) {
			case "login": {
				if (hasHelp(rest) || !rest[0]) {
					throw new Error(authLoginUsage());
				}
				const account = yield* withSpinner("Saving credentials...", authLogin(rest[0]));
				yield* Console.log(`token saved for ${account}`);
				return;
			}
			case "status": {
				if (hasHelp(rest)) {
					yield* Console.log(authStatusUsage());
					return;
				}
				const result = yield* withSpinner("Checking auth status...", authStatus);
				yield* Console.log(`account: ${result.account}`);
				yield* Console.log(`board: ${result.board}`);
				yield* Console.log(`authenticated: ${result.authenticated}`);
				if (result.identity) {
					yield* Console.log(`user: ${result.identity.name || ""}`);
					yield* Console.log(`user_id: ${result.identity.userId}`);
					yield* Console.log(`email: ${result.identity.email || ""}`);
				} else if (result.identityError) {
					yield* Console.log(`identity_error: ${result.identityError}`);
				}
				return;
			}
			case "logout": {
				if (hasHelp(rest)) {
					yield* Console.log(authLogoutUsage());
					return;
				}
				const account = yield* withSpinner("Clearing credentials...", authLogout);
				yield* Console.log(`token removed for ${account}`);
				return;
			}
			default:
				throw new Error(authUsage());
		}
	});

const authUsage = (): string => `fizzyx auth <command>

commands:
  auth login <token>
  auth status
  auth logout
  auth help`;

const authLoginUsage = (): string => "fizzyx auth login <token>";
const authStatusUsage = (): string => "fizzyx auth status";
const authLogoutUsage = (): string => "fizzyx auth logout";
