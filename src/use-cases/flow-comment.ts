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
): string => Bun.markdown.html(`${standardizedCommentTemplate(kind)}${escapeHtml(value)}`).trim();

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

/** Safe Markdown comment body without the `note:` prefix. */
export const buildPlainCommentBody = (value: string): string =>
  sanitizeMarkdownUrls(Bun.markdown.html(escapeHtml(value)).trim());

export const buildNoteCommentBody = (value: string): string => {
  const rendered = buildPlainCommentBody(value);
  if (rendered.startsWith("<p>")) {
    return rendered.replace("<p>", "<p>note: ");
  }
  return `<p>note:</p>\n${rendered}`;
};
