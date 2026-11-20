import { Effect } from "effect";
import { basename, isAbsolute, resolve } from "node:path";
import { ApiError, ValidationError } from "../domain/errors";

export interface ImageFile {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface RichTextOptions {
  /** Directory that relative image paths resolve against. */
  baseDir: string;
  /** Uploads one image and returns the Action Text attachable sgid. */
  uploadImage: (file: ImageFile) => Effect.Effect<string, ApiError>;
}

// Fizzy's editor (Lexxy) palette, in the editor's order: colour N is stored as
// var(--highlight-N) / var(--highlight-bg-N), so it follows the light/dark theme
// and stays editable in Fizzy.
const HIGHLIGHT_COLORS = [
  "yellow",
  "orange",
  "red",
  "magenta",
  "purple",
  "blue",
  "green",
  "sand",
  "gray",
];

// `==text==`, optionally followed by `{red}` (background) or `{text:red}` (text colour).
const HIGHLIGHT = /==(?=\S)([^=]*?\S)==(?:\{([^}\n]*)\})?/g;

const highlightStyle = (spec: string | undefined): string | undefined => {
  const match = (spec ?? "yellow")
    .trim()
    .toLowerCase()
    .match(/^(text:)?\s*([a-z]+)$/);
  const index = match ? HIGHLIGHT_COLORS.indexOf(match[2]!) + 1 : 0;
  if (!match || index === 0) return undefined;
  return match[1]
    ? `color:var(--highlight-${index});`
    : `background-color:var(--highlight-bg-${index});`;
};

// Splits rendered HTML into tags and text so highlights only touch text nodes
// outside code, never attribute values (sgids and URLs can contain `==`).
const applyHighlights = (html: string): string => {
  let codeDepth = 0;
  const unknown = new Set<string>();
  const output = html.split(/(<[^>]*>)/).map((part) => {
    const tag = part.match(/^<(\/?)(code|pre)\b/i);
    if (tag) codeDepth += tag[1] ? -1 : 1;
    if (part.startsWith("<") || codeDepth > 0 || !part.includes("==")) return part;
    return part.replace(HIGHLIGHT, (whole, text: string, spec: string | undefined) => {
      const style = highlightStyle(spec);
      if (!style) {
        unknown.add(`{${spec}}`);
        return whole;
      }
      return `<mark style="${style}">${text}</mark>`;
    });
  });
  if (unknown.size > 0) {
    throw new ValidationError({
      message: `Unknown highlight colour ${[...unknown].join(", ")}. Use {<colour>} or {text:<colour>} with one of: ${HIGHLIGHT_COLORS.join(", ")}`,
    });
  }
  return output.join("");
};

const decodeEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const attribute = (tag: string, name: string): string | undefined => {
  const value = tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
  return value === undefined ? undefined : decodeEntities(value);
};

const sniffImageType = (bytes: Uint8Array): string | undefined => {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return undefined;
};

const isRemote = (src: string): boolean => /^(?:https?:|data:)/i.test(src) || src.startsWith("//");

const localPath = (src: string, baseDir: string): string => {
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // keep the literal path; a bad escape is then reported as a missing file
  }
  return isAbsolute(decoded) ? decoded : resolve(baseDir, decoded);
};

const readImages = (paths: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const problems: string[] = [];
    const files = new Map<string, ImageFile>();
    for (const path of paths) {
      const file = Bun.file(path);
      const bytes = (yield* Effect.promise(() => file.exists()))
        ? yield* Effect.promise(() => file.bytes())
        : undefined;
      if (!bytes) {
        problems.push(`image not found: ${path}`);
        continue;
      }
      const contentType = sniffImageType(bytes);
      if (!contentType) {
        problems.push(`not a PNG, JPEG, GIF or WebP image: ${path}`);
        continue;
      }
      files.set(path, { filename: basename(path), contentType, bytes });
    }
    if (problems.length > 0) {
      return yield* new ValidationError({ message: `${problems.join("\n")}\nNothing was posted.` });
    }
    return files;
  });

const attachmentTag = (sgid: string, file: ImageFile, caption: string): string =>
  `<action-text-attachment sgid="${escapeAttribute(sgid)}" content-type="${file.contentType}" filename="${escapeAttribute(file.filename)}"${caption ? ` caption="${escapeAttribute(caption)}"` : ""}></action-text-attachment>`;

const IMG = /<img\b[^>]*>/g;

// Uploads every local `<img>` and swaps it for an Action Text attachment. All
// files are read and checked before the first upload, so a typo fails fast.
const embedLocalImages = (html: string, options: RichTextOptions) =>
  Effect.gen(function* () {
    const sources = [...html.matchAll(IMG)]
      .map((match) => attribute(match[0], "src"))
      .filter((src): src is string => Boolean(src) && !isRemote(src!));
    if (sources.length === 0) return html;

    const paths = [...new Set(sources.map((src) => localPath(src, options.baseDir)))];
    const files = yield* readImages(paths);
    const sgids = new Map<string, string>();
    for (const [path, file] of files) {
      const sgid = yield* options.uploadImage(file).pipe(
        Effect.mapError(
          (error) =>
            new ApiError({
              message: `Image upload failed for ${path}: ${error.message}. Nothing was posted.`,
              status: error.status,
            }),
        ),
      );
      sgids.set(path, sgid);
    }

    const embedded = html.replace(IMG, (tag) => {
      const src = attribute(tag, "src");
      if (!src || isRemote(src)) return tag;
      const path = localPath(src, options.baseDir);
      return attachmentTag(sgids.get(path)!, files.get(path)!, attribute(tag, "alt") ?? "");
    });
    // Fizzy stores attachments as blocks; a paragraph holding only images is unwrapped.
    return embedded.replace(
      /<p>((?:\s*<action-text-attachment\b[^>]*><\/action-text-attachment>)+)\s*<\/p>/g,
      (_, attachments: string) => attachments.trim(),
    );
  });

/** Applies `==highlight==` markup and uploads local images in rendered Markdown HTML. */
export const renderRichText = (
  html: string,
  options: RichTextOptions,
): Effect.Effect<string, ValidationError | ApiError> =>
  Effect.try({
    try: () => applyHighlights(html),
    catch: (error) =>
      error instanceof ValidationError ? error : new ValidationError({ message: String(error) }),
  }).pipe(Effect.flatMap((highlighted) => embedLocalImages(highlighted, options)));

/** True when Markdown uses image or highlight syntax that needs rendering. */
export const hasRichMarkdown = (markdown: string): boolean =>
  /!\[[^\]\n]*\]\([^)\s]+/.test(markdown) || /==(?=\S)[^=\n]*?\S==/.test(markdown);
