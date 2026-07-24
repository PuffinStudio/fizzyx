export const formatNoBoards = (): string => "(no boards)";

export const formatLoadingBoardsMessage = (): string => "Loading Fizzy boards...";

export const formatSetupUsage = (): string =>
	"usage: fizzyx init <board-id>\n       fizzyx init --list";

export const formatInitializingWorkflowMessage = (): string => "Initializing Fizzy workflow...";

export const formatSetupCreatedConfig = (configPath: string): string => `created ${configPath}`;

export const formatAgentInstructionsSynced = (
	action: "created" | "updated" | "unchanged",
	path: string,
): string => `AGENTS.md ${action}: ${path}`;

export const formatWorkspaceNoMembers = (): string =>
	"No subfolders found to include in the workspace.";

export const formatWorkspaceNoSelection = (): string =>
	"No folders selected. Workspace AGENTS.md was not written.";

export const formatWorkspaceSummary = (
	members: ReadonlyArray<{ name: string; configured: boolean; board?: string }>,
): string =>
	members
		.map((member) => {
			if (!member.configured) return `  ${member.name}/  (no fizzyx config)`;
			return `  ${member.name}/  fizzyx${member.board ? ` board ${member.board}` : ""}`;
		})
		.join("\n");
