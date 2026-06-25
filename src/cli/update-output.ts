export const formatAlreadyUpToDate = (version: string): string => `Already up to date (${version})`;

export const formatUpdateAvailable = (currentVersion: string, latestVersion: string): string =>
	`Update available: ${currentVersion} → ${latestVersion}`;

export const formatUpdatedTo = (latestVersion: string): string => `Updated to ${latestVersion}`;

export const formatUpdateInstallFailed = (): string => "Update installation failed";

export const formatInstallRunning = (): string => "Installing...";

export const formatUpdateCheckMessage = (): string => "Checking for updates...";
