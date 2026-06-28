export const formatFlowConfigured = (todoColumnId: string, inProgressColumnId: string): string =>
	`flow configured: todo=${todoColumnId} in_progress=${inProgressColumnId}`;

export const formatFlowConfigMissing = (): string => "flow config missing; initializing...";

export const formatInitializingWorkflowConfigMessage = (): string =>
	"Initializing workflow config...";
