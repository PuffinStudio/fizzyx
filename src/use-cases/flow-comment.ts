export type StandardizedCommentKind = "done" | "blocked" | "unblocked" | "handoff" | "note";

const escapeHtml = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const standardizedCommentTemplate = (kind: StandardizedCommentKind): string => {
	return {
		done: "done: ",
		blocked: "blocked: ",
		unblocked: "unblocked: ",
		handoff: "handoff: ",
		note: "note: ",
	}[kind];
};

export const buildStandardizedCommentBody = (
	kind: StandardizedCommentKind,
	value: string,
): string => `<p>${standardizedCommentTemplate(kind)}${escapeHtml(value)}</p>`;

export const getStandardizedCommentTemplate = (kind: StandardizedCommentKind): string => {
	if (kind === "done") {
		return "done: commit <sha>: <subject>";
	}

	if (kind === "blocked") {
		return "blocked: <reason; owner/decision needed>";
	}

	if (kind === "unblocked") {
		return "unblocked: <resource/decision ready>";
	}

	if (kind === "handoff") {
		return "handoff: <current state; next step>";
	}

	return "note: <brief note>";
};
