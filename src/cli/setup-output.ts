export const formatNoBoards = (): string => "(no boards)";

export const formatLoadingBoardsMessage = (): string => "Loading Fizzy boards...";

export const formatSetupUsage = (): string =>
	"usage: fizzyx init <board-id>\n       fizzyx init --list";

export const formatInitializingWorkflowMessage = (): string => "Initializing Fizzy workflow...";

export const formatSetupCreatedConfig = (configPath: string): string => `created ${configPath}`;
