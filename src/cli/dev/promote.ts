import { Array, Console, Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	checkPromotion,
	loadConfigOptional,
	getProductionBranch,
	getPromotionCommands,
	applyPromotion,
	formatPromotionChecks,
} from "../../use-cases/dev-service";
import { ui } from "../ui";

const handle = (config: {
	branch: string;
	to: string;
	dryRun: boolean;
	apply: boolean;
	confirmProduction: boolean;
	agent: boolean;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const projectConfig = yield* loadConfigOptional();
		const productionBranch = getProductionBranch(projectConfig);
		const isProduction = config.to === productionBranch;

		const checks = yield* checkPromotion(config.branch, config.to, projectConfig ?? undefined);
		const allPassed = Array.every(checks, (c) => c.passed);

		yield* Console.log(`Promotion checks: ${config.branch} -> ${config.to}`);
		yield* Console.log("");

		for (const check of checks) {
			const icon = check.passed ? "✓" : "✗";
			yield* Console.log(`  ${icon} ${check.reason}`);
		}

		yield* Console.log("");

		if (!allPassed) {
			if (config.agent) {
				yield* Console.log(formatPromotionChecks(checks, true, config.branch, config.to));
			}
			yield* Console.log(ui.error("Some checks failed. Fix the issues and try again."));
			return;
		}

		const commands = getPromotionCommands(config.branch, config.to, projectConfig);
		yield* Console.log("Commands that would run:");
		for (const cmd of commands) {
			yield* Console.log(`  ${ui.cmd(cmd.command)}  ${ui.dim(`# ${cmd.description}`)}`);
		}

		yield* Console.log("");
		if (config.dryRun) {
			if (isProduction && !config.confirmProduction) {
				yield* Console.log(ui.warn("Production promotion — add --confirm-production to apply."));
			}
			yield* Console.log(ui.info("Dry-run mode. No commands were executed."));
			yield* Console.log(ui.info("Run with --apply to execute the promotion."));
		} else if (config.apply) {
			if (isProduction && !config.confirmProduction) {
				yield* Console.log(ui.error("Production promotion requires --confirm-production."));
				return;
			}
			yield* Console.log(ui.info(`Executing promotion: ${config.branch} -> ${config.to}`));
			yield* Console.log("");
			const results = yield* applyPromotion(commands);
			let failed = false;
			for (const r of results) {
				const icon = r.exitCode === 0 ? "✓" : "✗";
				yield* Console.log(`  ${icon} ${ui.cmd(r.command)}  ${ui.dim(`# ${r.description}`)}`);
				if (r.output) {
					yield* Console.log(
						r.output
							.split("\n")
							.map((l) => `      ${l}`)
							.join("\n"),
					);
				}
				if (r.exitCode !== 0) {
					failed = true;
					break;
				}
			}
			yield* Console.log("");
			if (failed) {
				yield* Console.log(
					ui.error("Promotion stopped: a command failed. Resolve the issue and re-run."),
				);
			} else {
				yield* Console.log(ui.success(`Promoted ${config.branch} -> ${config.to}.`));
			}
		} else {
			if (isProduction && !config.confirmProduction) {
				yield* Console.log(ui.error("Production promotion requires --confirm-production."));
				return;
			}
			yield* Console.log(ui.info("Use --dry-run to preview or --apply to execute."));
		}

		if (config.agent) {
			yield* Console.log(formatPromotionChecks(checks, true, config.branch, config.to));
		}
	});

export const devPromoteCmd = Command.make(
	"promote",
	{
		branch: Argument.string("branch").pipe(
			Argument.withDescription("Source branch to promote"),
			Argument.withMetavar("BRANCH"),
		),
		to: Flag.string("to").pipe(
			Flag.withDescription("Target branch or environment"),
			Flag.withAlias("t"),
		),
		dryRun: Flag.boolean("dry-run").pipe(
			Flag.withDescription("Preview promotion commands without executing"),
		),
		apply: Flag.boolean("apply").pipe(Flag.withDescription("Execute the promotion")),
		confirmProduction: Flag.boolean("confirm-production").pipe(
			Flag.withDescription("Confirm production promotion"),
		),
		agent: Flag.boolean("agent").pipe(
			Flag.withDescription("Machine-readable output for AI agents"),
		),
	},
	handle,
).pipe(Command.withDescription("Promote a branch to an environment or production"));
