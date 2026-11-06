import { expect, test } from "bun:test";
import { Effect } from "effect";
import vm from "node:vm";
import { wxGenerator } from "../src/adapters/codegen-wx";
import { parseSpec } from "../src/use-cases/openapi-parser";

test("wx generation preserves nested quoted keys, literals and nullable array items", async () => {
  const spec = await parseSpec({
    openapi: "3.1.0",
    info: { title: "Application", version: "1" },
    paths: {},
    components: {
      schemas: {
        Settings: {
          type: "object",
          properties: {
            localized: {
              type: "object",
              properties: {
                "zh-CN": { type: "string" },
                "x-key": { type: "string" },
                'quote"key': { type: "number" },
                kind: { enum: ["product", "study"] },
                nullable: { anyOf: [{ type: "string" }, { type: "null" }] },
                values: { type: "array", items: { anyOf: [{ type: "string" }, { type: "null" }] } },
              },
            },
          },
        },
      },
    },
  });
  const files = await Effect.runPromise(wxGenerator.generate(spec, "unused"));
  const types = files.find((file) => file.path === "types.ts")!.content;
  expect(types).toContain('"zh-CN"?: string');
  expect(types).toContain('"x-key"?: string');
  expect(types).toContain('"quote\\\"key"?: number');
  expect(types).toContain('kind?: "product" | "study"');
  expect(types).toContain("nullable?: string | null");
  expect(types).toContain("values?: (string | null)[]");
  expect(() => new Bun.Transpiler({ loader: "ts" }).transformSync(types)).not.toThrow();
});

test("wx runtime delegates JSON to an application session without replacing structured failures", async () => {
  const files = await Effect.runPromise(
    wxGenerator.generate({ title: "Test", version: "1", endpoints: [], types: {} }, "unused"),
  );
  const source = files.find((file) => file.path === "wx-request.ts")!.content;
  type Runtime = {
    configure: (config: unknown) => void;
    request: (method: string, path: string, options?: unknown) => Promise<unknown>;
  };
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
    source.replace(/^export /gm, "") + "\nglobalThis.testRuntime = { configure, request }",
  );
  const sandbox: { testRuntime?: Runtime } = {};
  vm.runInNewContext(code, sandbox);
  const runtime = sandbox.testRuntime!;
  const calls: unknown[] = [];
  const failure = Object.assign(new Error("Conflict"), { status: 409, code: "stale-revision" });
  runtime.configure({
    tokenStorage: { get: () => null, set() {} },
    responseExtractor: (value: unknown) => value,
    transport: async (method: string, url: string, options: unknown) => {
      calls.push({ method, url, options });
      if (url === "/conflict") throw failure;
      return { code: "business-code", data: { id: "current-customer-only" } };
    },
  });
  expect(await runtime.request("GET", "/me")).toEqual({
    code: "business-code",
    data: { id: "current-customer-only" },
  });
  expect(calls).toEqual([{ method: "GET", url: "/me", options: {} }]);
  await expect(
    runtime.request("POST", "/conflict", { body: { expectedRevision: 2 } }),
  ).rejects.toBe(failure);
});
