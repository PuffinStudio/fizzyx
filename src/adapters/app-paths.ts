import { homedir } from "node:os";
import { CONFIG_FILE } from "../ports/config-repository";

/** Legacy official fizzy CLI config path relative to HOME */
export const OFFICIAL_CONFIG_FILE = ".config/fizzy/config.yaml";

/** fizzyx CLI config root directory relative to HOME */
export const FIZZYX_CONFIG_DIR = ".config/fizzyx";

/** Credentials subdirectory */
const CREDENTIALS_DIR = "credentials";

/** Cache subdirectory */
const CACHE_DIR = "cache";

/** Update check timestamp file */
const LAST_UPDATE_CHECK = "last-update-check";

const resolveHome = (): string => {
	const home = homedir();
	if (!home) throw new Error("HOME is not set");
	return home;
};

/** ~/.config/fizzyx */
export const resolveFizzyxConfigDir = (): string => `${resolveHome()}/${FIZZYX_CONFIG_DIR}`;

/** ~/.config/fizzyx/last-update-check */
export const resolveLastUpdateCheckPath = (): string =>
	`${resolveHome()}/${FIZZYX_CONFIG_DIR}/${LAST_UPDATE_CHECK}`;

/** ~/.config/fizzyx/credentials/<safeName>.json */
export const resolveCredentialPath = (profile: string): string =>
	`${resolveHome()}/${FIZZYX_CONFIG_DIR}/${CREDENTIALS_DIR}/${safePathSegment(profile)}.json`;

/** ~/.config/fizzy/cache/<account>/<board>/board.json */
export const resolveCachePath = (account: string, board: string): string => {
	if (!account) throw new Error("cache requires account");
	if (!board) throw new Error("cache requires board");
	return `${resolveHome()}/${FIZZYX_CONFIG_DIR}/${CACHE_DIR}/${safePathSegment(account)}/${safePathSegment(board)}/board.json`;
};

/** ~/.config/fizzy/cache/<account>/<board>/planner-snapshot.json */
export const resolvePlannerSnapshotCachePath = (account: string, board: string): string => {
	if (!account) throw new Error("cache requires account");
	if (!board) throw new Error("cache requires board");
	return `${resolveHome()}/${FIZZYX_CONFIG_DIR}/${CACHE_DIR}/${safePathSegment(account)}/${safePathSegment(board)}/planner-snapshot.json`;
};

/** ~/.config/fizzy/config.yaml */
export const resolveOfficialConfigPath = (): string => `${resolveHome()}/${OFFICIAL_CONFIG_FILE}`;

/** Current-directory .fizzy.yaml */
export const resolveProjectConfigPath = (cwd?: string): string =>
	`${cwd ?? process.cwd()}/${CONFIG_FILE}`;

const safePathSegment = (name: string): string => name.replace(/[./\\]/g, "_");
