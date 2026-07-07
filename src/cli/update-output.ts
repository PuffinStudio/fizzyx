export const formatAlreadyUpToDate = (version: string): string => `Already up to date (${version})`;

export const formatUpdateAvailable = (currentVersion: string, latestVersion: string): string =>
	`Update available: ${currentVersion} → ${latestVersion}`;

export const formatUpdatedTo = (latestVersion: string): string => `Updated to ${latestVersion}`;

export const formatLocalVersionNewer = (currentVersion: string, latestVersion: string): string =>
	`Current version (${currentVersion}) is newer than the latest registry version (${latestVersion})`;

export const formatUpdateInstallFailed = (exitCode: number): string =>
	`Update installation failed with exit code ${exitCode}`;

export const formatInstallRunning = (target: string): string => `Installing ${target} with Bun...`;

export const formatUpdateCheckMessage = (): string => "Checking for updates...";
