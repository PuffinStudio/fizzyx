import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { applySkillsMigration, inspectSkillsMigration } from "../use-cases/migrate";

const handleMigrate = ({
	apply,
}: {
	apply: boolean;
	check: boolean;
}): Effect.Effect<void, never, never> =>
	Effect.gen(function* () {
		if (apply) {
			const before = inspectSkillsMigration();
			const after = applySkillsMigration();
			const message = before.needsSkillsVersion
				? `Migration applied at ${after.writePath}; skills.version set to 1; no skills.lock.json.`
				: `Skills config is already up to date at ${after.writePath}; no skills.lock.json.`;
			yield* Console.log(message);
			return;
		}

		const report = inspectSkillsMigration();
		yield* Console.log(
			report.needsSkillsVersion
				? `skills.version missing in ${report.writePath}; run with --apply to add version 1; no skills.lock.json.`
				: `Skills config is up to date at ${report.writePath}; no skills.lock.json.`,
		);
	});

export const migrateCmd = Command.make(
	"migrate",
	{
		check: Flag.boolean("check").pipe(
			Flag.withDescription("Check whether skills config migration is needed"),
		),
		apply: Flag.boolean("apply").pipe(
			Flag.withDescription("Apply the minimal skills config migration"),
		),
	},
	handleMigrate,
).pipe(Command.withDescription("Check or apply the minimal 1.0 skills migration"));
