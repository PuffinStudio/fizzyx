import { beforeAll, expect, test } from "bun:test";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { makeFetchFizzyApi } from "../src/adapters/fetch-fizzy-api";
import type { ProjectConfig } from "../src/domain/models";

// tests/fetch-fizzy-api.test.ts replaces `globalThis.fetch` and Effect caches whichever fetch
// it saw first, so in a shared test process this file would talk to that mock. Dropping the
// cached value makes Effect pick up the real fetch again.
beforeAll(() => {
  delete (FetchHttpClient.Fetch as unknown as { [key: string]: unknown })[
    "~effect/Context/defaultValue"
  ];
});

const card = { number: 12, title: "Found" };

/** A Fizzy double whose search answers with the queued responses, in order. */
const startSearchServer = (responses: ReadonlyArray<() => Response>) => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => {
      const respond = responses[Math.min(calls, responses.length - 1)]!;
      calls += 1;
      return respond();
    },
  });
  const config: ProjectConfig = {
    apiUrl: `http://127.0.0.1:${server.port}`,
    account: "1",
    board: "board-1",
    configPath: "",
    rootDir: "/tmp",
  };
  return {
    api: makeFetchFizzyApi(config, "token"),
    calls: () => calls,
    stop: () => server.stop(true),
  };
};

const limited = (retryAfter: string) => () =>
  new Response("slow down", { status: 429, headers: { "retry-after": retryAfter } });
const found = () => Response.json([card]);

test("search waits once for a short Retry-After and then returns the result", async () => {
  const server = startSearchServer([limited("1"), found]);
  try {
    const started = Date.now();
    const cards = await Effect.runPromise(server.api.searchCards("found"));

    expect(cards.map((item) => item.number)).toEqual([12]);
    expect(server.calls()).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  } finally {
    server.stop();
  }
});

test("search fails at once, naming the wait, when the server asks for longer than a minute", async () => {
  const server = startSearchServer([limited("1800"), found]);
  try {
    const failure = await Effect.runPromise(server.api.searchCards("found").pipe(Effect.flip));

    expect(failure.status).toBe(429);
    expect(failure.message).toContain("1800s");
    expect(server.calls()).toBe(1);
  } finally {
    server.stop();
  }
});

test("search gives up after one wait when the server is still limiting", async () => {
  const server = startSearchServer([limited("1"), limited("1")]);
  try {
    const failure = await Effect.runPromise(
      server.api.listCards({ terms: ["found"] }).pipe(Effect.flip),
    );

    expect(failure.status).toBe(429);
    expect(server.calls()).toBe(2);
  } finally {
    server.stop();
  }
});

test("a numeric search answered with a single card is returned as a one-card list", async () => {
  const server = startSearchServer([() => Response.json(card)]);
  try {
    const cards = await Effect.runPromise(server.api.searchCards("12"));
    expect(cards.map((item) => item.number)).toEqual([12]);
  } finally {
    server.stop();
  }
});
