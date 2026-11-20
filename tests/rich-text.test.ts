import { Effect } from "effect";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { ValidationError } from "../src/domain/errors";
import type { FizzyApi } from "../src/ports/fizzy-api";
import { addComment, editComment } from "../src/use-cases/flow-service";
import type { ImageFile } from "../src/use-cases/rich-text";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "fizzyx-rich-"));
  dirs.push(dir);
  return dir;
};

const fakeApi = () => {
  const uploads: ImageFile[] = [];
  const posted: string[] = [];
  const api = {
    uploadImage: (file: ImageFile) => {
      uploads.push(file);
      return Effect.succeed(`sgid-${uploads.length}`);
    },
    comment: (_number: number, body: string) => {
      posted.push(body);
      return Effect.succeed(undefined);
    },
    updateComment: (_number: number, _id: string, body: string) => {
      posted.push(body);
      return Effect.succeed(undefined);
    },
  } as unknown as FizzyApi;
  return { api, uploads, posted };
};

const env = (api: FizzyApi) => ({ config: {}, api }) as never;

test("local images upload once each and become captioned attachments; remote images stay", async () => {
  const dir = tempDir();
  mkdirSync(join(dir, "shots"));
  writeFileSync(join(dir, "shots", "截图 1.png"), PNG);
  writeFileSync(join(dir, "b.jpg"), JPEG);
  const { api, uploads, posted } = fakeApi();

  await Effect.runPromise(
    editComment(
      env(api),
      922,
      "c-1",
      [
        "Intro",
        "",
        '![详情 "A" & B](shots/截图%201.png)',
        "![again](shots/截图%201.png)",
        "",
        "![](b.jpg)",
        "",
        "![remote](https://example.com/x.png)",
      ].join("\n"),
      { baseDir: dir, noPrefix: true },
    ),
  );

  expect(uploads.map((file) => [file.filename, file.contentType, file.bytes.length])).toEqual([
    ["截图 1.png", "image/png", PNG.length],
    ["b.jpg", "image/jpeg", JPEG.length],
  ]);
  expect(posted).toEqual([
    [
      "<p>Intro</p>",
      '<action-text-attachment sgid="sgid-1" content-type="image/png" filename="截图 1.png" caption="详情 &quot;A&quot; &amp; B"></action-text-attachment>',
      '<action-text-attachment sgid="sgid-1" content-type="image/png" filename="截图 1.png" caption="again"></action-text-attachment>',
      '<action-text-attachment sgid="sgid-2" content-type="image/jpeg" filename="b.jpg"></action-text-attachment>',
      '<p><img src="https://example.com/x.png" alt="remote" /></p>',
    ].join("\n"),
  ]);
});

test("a missing or non-image file fails before any upload or post", async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "ok.png"), PNG);
  writeFileSync(join(dir, "notes.png"), "plain text");
  const { api, uploads, posted } = fakeApi();

  const error = await Effect.runPromise(
    Effect.flip(
      addComment(env(api), 7, "![a](ok.png)\n\n![b](missing.png)\n\n![c](notes.png)", {
        baseDir: dir,
      }),
    ),
  );

  expect(error).toBeInstanceOf(ValidationError);
  expect(error.message).toContain(`image not found: ${join(dir, "missing.png")}`);
  expect(error.message).toContain(`not a PNG, JPEG, GIF or WebP image: ${join(dir, "notes.png")}`);
  expect(uploads).toEqual([]);
  expect(posted).toEqual([]);
});

test("images outside the Markdown directory or without an image extension are refused unless allowed", async () => {
  const outside = tempDir();
  const dir = join(outside, "notes");
  mkdirSync(dir);
  writeFileSync(join(outside, "secret.png"), PNG);
  writeFileSync(join(dir, "id_ed25519"), "-----BEGIN OPENSSH PRIVATE KEY-----");
  symlinkSync(join(outside, "secret.png"), join(dir, "link.png"));
  const body = `![a](../secret.png)\n\n![b](${join(outside, "secret.png")})\n\n![c](link.png)\n\n![d](id_ed25519)`;
  const { api, uploads, posted } = fakeApi();

  const error = await Effect.runPromise(
    Effect.flip(addComment(env(api), 7, body, { baseDir: dir })),
  );

  expect(error).toBeInstanceOf(ValidationError);
  // `../secret.png` and the absolute path are the same file; the symlink is resolved too.
  for (const name of [join(outside, "secret.png"), join(dir, "link.png")]) {
    expect(error.message).toContain(
      `image outside ${dir}: ${name} (pass --allow-image-paths-outside`,
    );
  }
  expect(error.message).toContain(
    `not a .png, .jpg, .jpeg, .gif or .webp file: ${join(dir, "id_ed25519")}`,
  );
  expect(uploads).toEqual([]);
  expect(posted).toEqual([]);

  await Effect.runPromise(
    addComment(env(api), 7, "![a](../secret.png)", { baseDir: dir, allowOutside: true }),
  );
  expect(uploads.map((file) => file.filename)).toEqual(["secret.png"]);
});

test("highlights map to Fizzy's stored editor markup, outside code only", async () => {
  const { api, posted } = fakeApi();

  await Effect.runPromise(
    addComment(
      env(api),
      7,
      "选 ==A== / ==已确认=={green} / ==A=={text:red}\n\n`==code==` a == b == c, if (a==b && c==d)",
    ),
  );

  expect(posted).toEqual([
    '<p>note: 选 <mark style="background-color:var(--highlight-bg-1);">A</mark> / <mark style="background-color:var(--highlight-bg-7);">已确认</mark> / <mark style="color:var(--highlight-3);">A</mark></p>\n<p><code>==code==</code> a == b == c, if (a==b &amp;&amp; c==d)</p>',
  ]);
});

test("an unknown highlight colour is rejected without posting", async () => {
  const { api, posted } = fakeApi();

  const error = await Effect.runPromise(Effect.flip(addComment(env(api), 7, "==x=={teal}")));

  expect(error).toBeInstanceOf(ValidationError);
  expect(error.message).toContain("{teal}");
  expect(posted).toEqual([]);
});
