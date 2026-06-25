export const formatNoBoards = (): string => "(no boards)";

export const formatLoadingBoardsMessage = (): string => "Loading Fizzy boards...";

export const formatSetupUsage = (): string =>
	"usage: fizzyx setup <board-id>\n       fizzyx setup --list";

export const formatInitializingWorkflowMessage = (): string => "Initializing Fizzy workflow...";

export const formatSetupCreatedConfig = (configPath: string): string => `created ${configPath}`;
