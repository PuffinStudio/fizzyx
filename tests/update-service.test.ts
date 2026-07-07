import { expect, test } from "bun:test";
import {
	checkFizzyxUpdate,
	compareVersions,
	type FetchImpl,
	runFizzyxUpdate,
} from "../src/use-cases/update-service";

const fetchVersion =
	(version: string): FetchImpl =>
	async () =>
		Response.json({ version });

test("compareVersions orders stable and prerelease semver versions", () => {
	expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
	expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
	expect(compareVersions("1.2.1", "1.2.0")).toBe(1);
	expect(compareVersions("1.2.0-beta.1", "1.2.0")).toBe(-1);
	expect(compareVersions("1.2.0-beta.2", "1.2.0-beta.1")).toBe(1);
	expect(compareVersions("not-a-version", "1.2.0")).toBe(null);
});

test("checkFizzyxUpdate returns already-current when registry matches current version", async () => {
	await expect(
		checkFizzyxUpdate({
			currentVersion: "1.1.0",
			fetchImpl: fetchVersion("1.1.0"),
		}),
	).resolves.toEqual({
		status: "already-current",
		currentVersion: "1.1.0",
		latestVersion: "1.1.0",
	});
});

test("checkFizzyxUpdate plans a Bun install pinned to the latest version", async () => {
	await expect(
		checkFizzyxUpdate({
			currentVersion: "1.1.0",
			fetchImpl: fetchVersion("1.2.0"),
		}),
	).resolves.toEqual({
		status: "update-available",
		currentVersion: "1.1.0",
		latestVersion: "1.2.0",
		target: "@puffinstudio/fizzyx@1.2.0",
	});
});

test("checkFizzyxUpdate does not downgrade a newer local version", async () => {
	await expect(
		checkFizzyxUpdate({
			currentVersion: "1.3.0",
			fetchImpl: fetchVersion("1.2.0"),
		}),
	).resolves.toEqual({
		status: "local-newer",
		currentVersion: "1.3.0",
		latestVersion: "1.2.0",
	});
});

test("runFizzyxUpdate reports installer failures without hiding the target", async () => {
	const installedTargets: string[] = [];
	await expect(
		runFizzyxUpdate({
			currentVersion: "1.1.0",
			fetchImpl: fetchVersion("1.2.0"),
			install: (target) => {
				installedTargets.push(target);
				return { exitCode: 42 };
			},
		}),
	).resolves.toEqual({
		status: "install-failed",
		currentVersion: "1.1.0",
		latestVersion: "1.2.0",
		target: "@puffinstudio/fizzyx@1.2.0",
		exitCode: 42,
	});
	expect(installedTargets).toEqual(["@puffinstudio/fizzyx@1.2.0"]);
});
