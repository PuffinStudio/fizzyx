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

const safeMarkdownUrl = (value: string): boolean => {
	const entityDecoded = value
		.replace(/&amp;/gi, "&")
		.replace(/(?:&#0*58;|&#x0*3a;|&colon;)/gi, ":");
	let decoded = entityDecoded;
	try {
		decoded = decodeURIComponent(entityDecoded);
	} catch {
		return false;
	}
	const normalized = decoded.trim().toLowerCase();
	return (
		normalized.startsWith("https://") ||
		normalized.startsWith("http://") ||
		normalized.startsWith("mailto:") ||
		normalized.startsWith("/") ||
		normalized.startsWith("#") ||
		!normalized.match(/^[a-z][a-z0-9+.-]*:/)
	);
};

const sanitizeMarkdownUrls = (html: string): string =>
	html.replace(/\s(href|src)="([^"]*)"/g, (attribute, _name: string, value: string) =>
		safeMarkdownUrl(value) ? attribute : "",
	);

export const buildNoteCommentBody = (value: string): string => {
	const rendered = sanitizeMarkdownUrls(Bun.markdown.html(escapeHtml(value)).trim());
	if (rendered.startsWith("<p>")) {
		return rendered.replace("<p>", "<p>note: ");
	}
	return `<p>note:</p>\n${rendered}`;
};

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
