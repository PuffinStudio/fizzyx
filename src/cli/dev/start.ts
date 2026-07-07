import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	startBranch,
	getStatus,
	loadConfigOptional,
	isOnCompatibleBranch,
} from "../../use-cases/dev-service";
import { logInfo, logSuccess } from "../ui";

const handle = (config: {
	slug: string;
	kind: Option.Option<string>;
	card: Option.Option<string>;
	base: Option.Option<string>;
	allowDirty: boolean;
	fromCurrent: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const kind = Option.getOrElse(config.kind, () => "feature");
		const card = Option.getOrElse(config.card, () => undefined);

		const projectConfig = yield* loadConfigOptional();
		const status = yield* getStatus(projectConfig);

		const compatible = projectConfig
			? isOnCompatibleBranch(status.currentBranch, kind, config.slug, card, projectConfig)
			: undefined;
		if (compatible) {
			yield* Console.log(compatible);
			return;
		}

		if (status.role === "protected" && !config.fromCurrent) {
			yield* Console.log(`On protected branch '${status.currentBranch}'. Creating a new branch.`);
		}

		const result = yield* startBranch(config.slug, {
			kind,
			card,
			base: Option.getOrElse(config.base, () => undefined),
			allowDirty: config.allowDirty,
			fromCurrent: config.fromCurrent,
		});

		yield* logSuccess(`Created and switched to branch '${result.branchName}'`);
		if (result.configUpdated) {
			yield* logInfo(
				`Updated .fizzyx.yaml with branch metadata${result.configPath ? ` (${result.configPath})` : ""}`,
			);
		}
	});

export const devStartCmd = Command.make(
	"start",
	{
		slug: Argument.string("slug").pipe(
			Argument.withDescription("Branch slug (e.g. payment-coupon)"),
			Argument.withMetavar("SLUG"),
		),
		kind: Flag.optional(
			Flag.string("kind").pipe(
				Flag.withDescription("Branch kind: feature, fix, hotfix, ops, chore, docs"),
			),
		),
		card: Flag.optional(Flag.string("card").pipe(Flag.withDescription("Card number to associate"))),
		base: Flag.optional(Flag.string("base").pipe(Flag.withDescription("Base branch"))),
		allowDirty: Flag.boolean("allow-dirty").pipe(
			Flag.withDescription("Allow starting with uncommitted changes"),
		),
		fromCurrent: Flag.boolean("from-current").pipe(
			Flag.withDescription("Branch from current HEAD instead of base branch"),
		),
	},
	handle,
).pipe(Command.withDescription("Create or enter a development branch"));
