import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	addSkill,
	doctorSkillConfig,
	getSkillInfo,
	listSkills,
	migrateSkills,
	removeSkill,
	runSkill,
	updateSkills,
} from "../use-cases/skill-service";

const skillListCmd = Command.make("list", {}, () =>
	Effect.gen(function* () {
		for (const skill of listSkills()) {
			yield* Console.log(
				`${skill.name}\t${skill.source}\t${skill.version ?? "-"}\t${skill.status}`,
			);
		}
	}),
).pipe(Command.withDescription("List built-in and project-installed skills"));

const skillAddCmd = Command.make(
	"add",
	{
		source: Argument.string("source").pipe(
			Argument.withDescription("Skill source or built-in name"),
			Argument.withMetavar("SOURCE"),
		),
	},
	({ source }) =>
		Effect.gen(function* () {
			const skill = addSkill(source);
			yield* Console.log(`Installed ${skill.name} from ${skill.source} at ${skill.version}.`);
		}),
).pipe(Command.withDescription("Add a skill to the project config"));

const skillRemoveCmd = Command.make(
	"remove",
	{
		name: Argument.string("name").pipe(
			Argument.withDescription("Installed skill name"),
			Argument.withMetavar("NAME"),
		),
	},
	({ name }) =>
		Effect.gen(function* () {
			const result = removeSkill(name);
			yield* Console.log(`removed ${name}; checked ${result.deletedPath ?? ".agents/skills"}`);
		}),
).pipe(Command.withDescription("Remove a skill from the project config"));

const skillUpdateCmd = Command.make(
	"update",
	{
		name: Argument.string("name").pipe(
			Argument.withDescription("Optional skill name"),
			Argument.withMetavar("NAME"),
			Argument.optional,
		),
	},
	({ name }) =>
		Effect.gen(function* () {
			yield* Console.log(updateSkills(Option.getOrElse(name, () => undefined)));
		}),
).pipe(Command.withDescription("Update skill metadata when supported"));

const skillInfoCmd = Command.make(
	"info",
	{
		name: Argument.string("name").pipe(
			Argument.withDescription("Skill name"),
			Argument.withMetavar("NAME"),
		),
	},
	({ name }) =>
		Effect.gen(function* () {
			const skill = getSkillInfo(name);
			yield* Console.log(`name: ${skill.name}`);
			yield* Console.log(`source: ${skill.source}`);
			yield* Console.log(`version: ${skill.version ?? "-"}`);
			yield* Console.log(`status: ${skill.status}`);
		}),
).pipe(Command.withDescription("Show installed or built-in skill metadata"));

const skillRunCmd = Command.make(
	"run",
	{
		name: Argument.string("name").pipe(
			Argument.withDescription("Skill name"),
			Argument.withMetavar("NAME"),
		),
	},
	({ name }) =>
		Effect.gen(function* () {
			yield* Console.log(runSkill(name));
		}),
).pipe(Command.withDescription("Print the local invocation guidance for a skill"));

const skillDoctorCmd = Command.make("doctor", {}, () =>
	Effect.gen(function* () {
		yield* Console.log(doctorSkillConfig());
	}),
).pipe(Command.withDescription("Validate local skill config shape"));

const skillMigrateCmd = Command.make(
	"migrate",
	{
		check: Flag.boolean("check").pipe(
			Flag.withDescription("Check whether skill migration is needed"),
		),
		apply: Flag.boolean("apply").pipe(Flag.withDescription("Apply the minimal skill migration")),
	},
	({ apply }) =>
		Effect.gen(function* () {
			yield* Console.log(migrateSkills(apply ? "apply" : "check"));
		}),
).pipe(Command.withDescription("Check or apply the minimal skill migration"));

export const skillCmd = Command.make("skill").pipe(
	Command.withDescription("Manage Fizzyx skills"),
	Command.withSubcommands([
		skillListCmd,
		skillAddCmd,
		skillRemoveCmd,
		skillUpdateCmd,
		skillInfoCmd,
		skillRunCmd,
		skillDoctorCmd,
		skillMigrateCmd,
	]),
);
