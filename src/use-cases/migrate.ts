import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	ensureSkillsSection,
	loadConfigContext,
	numberValue,
	objectValue,
	writeYaml,
} from "../_shared/config-utils";

export type SkillsMigrationReport = {
	writePath: string;
	lockFilePath: string;
	lockFileExists: boolean;
	skillsVersion?: number;
	needsSkillsVersion: boolean;
};

export const inspectSkillsMigration = (): SkillsMigrationReport => {
	const context = loadConfigContext();
	const skills = objectValue(context.document.skills);
	const version = numberValue(skills.version);
	const lockFilePath = join(context.rootDir, "skills.lock.json");

	return {
		writePath: context.writePath,
		lockFilePath,
		lockFileExists: existsSync(lockFilePath),
		skillsVersion: version,
		needsSkillsVersion: version !== 1,
	};
};

export const applySkillsMigration = (): SkillsMigrationReport => {
	const context = loadConfigContext();
	const report = inspectSkillsMigration();

	if (!report.needsSkillsVersion) {
		return report;
	}

	const skills = ensureSkillsSection(context.document);
	skills.version = 1;
	context.document.skills = skills;
	writeYaml(context.writePath, context.document);

	return inspectSkillsMigration();
};
