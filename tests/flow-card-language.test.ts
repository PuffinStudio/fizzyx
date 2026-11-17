import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProjectConfig, renderProjectConfig } from "../src/adapters/config-codec";
import { parseTemplateDescription } from "../src/use-cases/flow-card-content";

const entry = join(import.meta.dir, "..", "src", "main.ts");

const draftFor = async (flowYaml: string, localTemplate?: string): Promise<string> => {
  const root = mkdtempSync(join(tmpdir(), "fizzyx-language-"));
  try {
    Bun.spawnSync(["git", "init"], { cwd: root, stdout: "ignore", stderr: "ignore" });
    writeFileSync(
      join(root, ".fizzyx.yaml"),
      `api_url: https://example.com\naccount: 1\nboard: board-1\n${flowYaml}`,
    );
    if (localTemplate !== undefined) {
      const dir = join(root, ".agents", "skills", "fizzyx");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "CARD_TEMPLATE.md"), localTemplate);
    }
    const proc = Bun.spawn(["bun", "run", entry, "flow", "create", "--draft"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    expect(exitCode).toBe(0);
    return readFileSync(stdout.trim(), "utf8");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const headings = (draft: string) => draft.split("\n").filter((line) => line.startsWith("## "));

test("flow.card.language selects the built-in template while parsed headings stay English", async () => {
  const english = await draftFor("");
  const chinese = await draftFor("flow:\n  card:\n    language: zh-CN\n");

  expect(chinese).not.toBe(english);
  expect(/[一-鿿]/.test(chinese)).toBe(true);
  expect(/[一-鿿]/.test(english)).toBe(false);
  expect(headings(chinese).every((line) => /^## [A-Za-z ]+$/.test(line))).toBe(true);

  // The translated template must still produce a creatable card: tags and steps are found.
  const parsed = parseTemplateDescription(chinese);
  expect(parsed.templateSteps).toHaveLength(3);
  expect(parsed.templateTags).toContain("priority:p2");
});

test("a project-local CARD_TEMPLATE.md wins over the configured language", async () => {
  const local = "## Goal\nLocal template\n\n## Steps\n\n- [ ] Local step";
  const draft = await draftFor("flow:\n  card:\n    language: zh-CN\n", local);

  expect(draft.trim()).toBe(local);
});

test("an unknown card language falls back to English and init keeps a configured one", () => {
  const base = "api_url: https://example.com\naccount: 1\nboard: board-1\n";
  const parse = (text: string) => parseProjectConfig(text, "/tmp/.fizzyx.yaml", "/tmp");

  expect(parse(`${base}flow:\n  card:\n    language: jp\n`).cardLanguage).toBeUndefined();
  expect(parse(`${base}flow:\n  card:\n    language: zh-CN\n`).cardLanguage).toBe("zh-CN");

  const rewritten = renderProjectConfig(
    { account: "1", board: "board-1", todoColumn: "todo", inProgressColumn: "doing", users: {} },
    `${base}flow:\n  card:\n    language: zh-CN\n`,
  );
  expect(parse(rewritten).cardLanguage).toBe("zh-CN");
});
