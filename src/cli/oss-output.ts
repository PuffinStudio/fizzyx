export const formatNoObjects = (env: string): string => `${env}: no objects found`;

export const formatObjectCount = (env: string, count: number): string => `${env}: ${count} objects`;

export const formatTruncatedObjects = (): string => "  ... (truncated, more objects available)";

export const formatSyncSummary = (
	env: string,
	uploaded: number,
	skipped: number,
	duration: string,
): string => `${env} synced · ${uploaded} uploaded · ${skipped} skipped · ${duration}`;

export const formatUploadedObject = (base: string, key: string): string => `    ${base}/${key}`;

export const formatStatusEnv = (env: string): string => `env: ${env}`;

export const formatStatusTotalLocal = (count: number): string => `total local files: ${count}`;

export const formatStatusManifestEntries = (count: number): string => `manifest entries: ${count}`;

export const formatStatusPendingUploads = (count: number): string => `pending uploads: ${count}`;

export const formatStatusPendingDeletions = (count: number): string =>
	`pending deletions: ${count}`;

export const formatPendingUploadHeader = (): string => "\npending upload files:";

export const formatPendingDeletionHeader = (): string => "\nmanifest-only files:";

export const formatPendingUploadItem = (file: string): string => `  + ${file}`;

export const formatPendingDeletionItem = (file: string): string => `  - ${file}`;

export const formatManifestPath = (manifestPath: string): string => `manifest: ${manifestPath}`;

export const formatOssScaffoldWritten = (): string => "OSS scaffold written to .fizzyx.yaml";

export const formatOssConfigHint = (): string =>
	"Edit endpoint, region, local_dir, and optionally bucket/remote_prefix in the file";

export const formatConfiguringKeys = (env: string): string => `Configuring keys for [${env}]:`;

export const formatKeysMissingMessage = (): string =>
	"Keys not provided — add them later with: fizzyx oss setup --env <name>";

export const formatCredentialsStored = (): string =>
	"Credentials stored in OS keychain (service: fizzyx-oss)";

export const formatSetupUsage = (): string =>
	"Usage: fizzyx oss setup --env <name> --endpoint <url> --region <region> --local-dir <path> [--bucket <name>] [--remote-prefix <prefix>]";

export const formatConfiguringOss = (env: string): string => `Configuring OSS [${env}]:`;

export const formatAccessKeyIdPrompt = (): string => "  Access Key ID: ";

export const formatSecretAccessKeyPrompt = (): string => "  Secret Access Key: ";

export const formatListingObjectsMessage = (env: string): string => `Listing ${env}...`;

export const formatCheckingOssStatusMessage = (): string => "Checking OSS status...";

export const formatCheckingOssConfigMessage = (): string => "Checking OSS config...";

export const formatStoringCredentialsMessage = (): string => "Storing credentials...";

export const formatWritingOssConfigMessage = (): string => "Writing OSS config...";

export const formatNoCredentialsMessage = (): string =>
	"Access Key ID and Secret Access Key are required";

export const formatOssConfigWritten = (env: string, endpoint: string): string =>
	`OSS ${env} config written to ${endpoint}`;

export const formatBlankLine = (): string => "";
