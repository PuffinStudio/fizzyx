import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { resolve } from "node:path";
import { ValidationError } from "../../domain/errors";
import { addComment, editComment } from "../../use-cases/flow-service";
import { markdownBaseDir, readDescription } from "../flow-input";
import { runWithFlowRuntimeEnv } from "../flow-workflow";
import { flowJson } from "../flow-json";

// `--attach a.png` appends `![](/abs/a.png)`; segments are URL-encoded so spaces
// and brackets in file names survive the Markdown parser.
const attachmentMarkdown = (paths: ReadonlyArray<string>): string =>
  paths
    .map((path) => `![](${resolve(path).split("/").map(encodeURIComponent).join("/")})`)
    .join("\n\n");

const handleComment = (config: {
  card: number;
  body: Option.Option<string>;
  bodyFile: Option.Option<string>;
  edit: Option.Option<string>;
  attach: ReadonlyArray<string>;
  noPrefix: boolean;
  allowOutside: boolean;
  json: boolean;
}): Effect.Effect<void, any, any> =>
  Effect.gen(function* () {
    if (Option.isSome(config.body) === Option.isSome(config.bodyFile)) {
      return yield* new ValidationError({
        message: "Provide exactly one comment body or --body-file <file|->",
      });
    }
    const text = Option.isSome(config.body)
      ? config.body.value
      : yield* readDescription(Option.getOrElse(config.bodyFile, () => ""));
    const body = config.attach.length
      ? `${text.trimEnd()}\n\n${attachmentMarkdown(config.attach)}`
      : text;
    const options = {
      baseDir: markdownBaseDir(Option.getOrUndefined(config.bodyFile)),
      noPrefix: config.noPrefix,
      allowOutside: config.allowOutside,
      allowedPaths: config.attach,
    };
    const editId = Option.getOrUndefined(config.edit);
    const editing = editId !== undefined;
    const result = yield* runWithFlowRuntimeEnv(
      editing ? "Updating comment..." : "Adding comment...",
      (env) =>
        editing
          ? editComment(env, config.card, editId, body, options)
          : addComment(env, config.card, body, options),
    );
    const message = editing
      ? `updated comment ${editId} on #${result.number}`
      : `commented #${result.number}`;
    yield* Console.log(
      config.json
        ? flowJson(result, message, [
            {
              action: "show",
              cmd: `fizzyx flow show ${result.number}`,
              description: "View the card",
            },
          ])
        : message,
    );
  });

export const flowCommentCmd = Command.make(
  "comment",
  {
    card: Argument.integer("card").pipe(
      Argument.withDescription("Card number"),
      Argument.withMetavar("CARD"),
    ),
    body: Argument.string("body").pipe(Argument.withDescription("Comment text"), Argument.optional),
    bodyFile: Flag.string("body-file").pipe(
      Flag.withDescription(
        "Markdown comment file path ('-' for stdin). ![caption](shot.png) uploads local images (relative to the file); ==text==, ==text=={red} and ==text=={text:red} highlight",
      ),
      Flag.optional,
    ),
    edit: Flag.string("edit").pipe(
      Flag.withDescription("Existing comment id to update"),
      Flag.optional,
    ),
    attach: Flag.string("attach").pipe(
      Flag.withDescription("Image file to append to the comment (repeatable)"),
      Flag.atLeast(0),
    ),
    noPrefix: Flag.boolean("no-prefix").pipe(
      Flag.withDescription("Post the body as written, without the 'note:' prefix"),
    ),
    allowOutside: Flag.boolean("allow-image-paths-outside").pipe(
      Flag.withDescription(
        "Allow Markdown images from outside the Markdown file's directory (or cwd for stdin)",
      ),
    ),
    json: Flag.boolean("json").pipe(Flag.withDescription("Print the result as JSON")),
  },
  handleComment,
).pipe(
  Command.withDescription(
    "Add or edit a Markdown comment on a card; local images upload as attachments",
  ),
);
