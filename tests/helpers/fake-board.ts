import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeCard = Record<string, unknown> & { number: number; title: string };

export interface FakeBoard {
  projectDir: string;
  homeDir: string;
  comments: Array<{ card: number; body: string }>;
  closed: number[];
  patchedSteps: string[];
  run: (
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> },
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  stop: () => void;
}

/**
 * A Fizzy API double plus a configured project directory, so flow commands can be driven
 * through the real CLI entry point without touching a real board.
 */
export const startFakeBoard = (input: {
  cards: ReadonlyArray<FakeCard>;
  flowYaml?: string;
}): FakeBoard => {
  const root = mkdtempSync(join(tmpdir(), "fizzyx-board-"));
  const projectDir = join(root, "project");
  const homeDir = join(root, "home");
  mkdirSync(projectDir, { recursive: true });
  const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
  mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }));

  const comments: FakeBoard["comments"] = [];
  const closed: number[] = [];
  const patchedSteps: string[] = [];

  const api = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (path === "/my/identity.json") {
        return Response.json({ user: { id: "me", name: "Me", email: "me@example.com" } });
      }
      if (path === "/1/boards/board-1/columns.json" && req.method === "GET") {
        return Response.json([
          { id: "todo-id", name: "TODO" },
          { id: "inprogress-id", name: "IN PROGRESS" },
        ]);
      }
      if (path === "/1/cards.json" && req.method === "GET") {
        if (url.searchParams.get("indexed_by")) return Response.json([]);
        return Response.json(input.cards);
      }
      const cardMatch = path.match(/^\/1\/cards\/(\d+)(?:\.json)?$/);
      if (cardMatch && req.method === "GET") {
        const card = input.cards.find((item) => item.number === Number(cardMatch[1]));
        return card ? Response.json(card) : new Response("not found", { status: 404 });
      }
      const sub = path.match(/^\/1\/cards\/(\d+)\/(comments\.json|closure\.json|steps\/.+)$/);
      if (sub) {
        const number = Number(sub[1]);
        if (sub[2] === "comments.json" && req.method === "GET") return Response.json([]);
        if (sub[2] === "comments.json" && req.method === "POST") {
          comments.push({ card: number, body: String((await req.json()).body ?? "") });
          return Response.json({});
        }
        if (sub[2] === "closure.json" && req.method === "POST") {
          closed.push(number);
          return Response.json({});
        }
        if (req.method === "PATCH") {
          patchedSteps.push(path);
          return Response.json({});
        }
      }
      return new Response("not found", { status: 404 });
    },
  });

  writeFileSync(
    join(projectDir, ".fizzyx.yaml"),
    `api_url: http://127.0.0.1:${api.port}\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n${input.flowYaml ?? ""}`,
  );

  const entry = join(import.meta.dir, "..", "..", "src", "main.ts");
  return {
    projectDir,
    homeDir,
    comments,
    closed,
    patchedSteps,
    run: async (args, options) => {
      const proc = Bun.spawn(["bun", "run", entry, ...args], {
        cwd: options?.cwd ?? projectDir,
        env: { ...process.env, HOME: homeDir, ...options?.env } as NodeJS.ProcessEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    },
    stop: () => {
      api.stop(true);
      rmSync(root, { recursive: true, force: true });
    },
  };
};
