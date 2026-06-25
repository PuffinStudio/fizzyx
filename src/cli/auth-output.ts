export const formatAuthLoginMessage = (account: string): string => `token saved for ${account}`;

export const formatAuthLogoutMessage = (account: string): string => `token removed for ${account}`;

export const formatAuthIdentityError = (error: string): string => `identity_error: ${error}`;

export const formatSavingCredentialsMessage = (): string => "Saving credentials...";

export const formatCheckingAuthStatusMessage = (): string => "Checking auth status...";

export const formatClearingCredentialsMessage = (): string => "Clearing credentials...";
