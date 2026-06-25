export const legacyFlowCommands = {
	sync: "sync",
	mine: "mine",
	status: "status",
	next: "next",
	show: "show",
	start: "start",
	done: "done",
	block: "block",
	add: "add",
	"steps-from-desc": "steps-from-desc",
	"repair-markdown": "repair-markdown",
	"complete-steps": "complete-steps",
	"comment-template": "comment-template",
	"standardize-card": "standardize",
	"standardize-board": "standardize-all",
	std: "std",
	"std-all": "std-all",
	standardize: "standardize",
	"standardize-all": "standardize-all",
	workflow: "workflow",
	skill: "skill",
} as const;

export const legacyCommandErrorMessage = (command: string): string => {
	const legacy = legacyFlowCommands[command as keyof typeof legacyFlowCommands];
	if (legacy) {
		return `unknown command: ${command}. Did you mean: fizzyx flow ${legacy}?`;
	}
	return `unknown command: ${command}`;
};
