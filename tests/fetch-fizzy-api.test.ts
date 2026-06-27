import { expect, test } from "bun:test";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { ApiError } from "../src/domain/errors";
import type { ProjectConfig } from "../src/domain/models";
import { makeFetchFizzyApi } from "../src/adapters/fetch-fizzy-api";

type FetchCall = {
	input: string;
	init?: RequestInit;
};

const makeConfig = (): ProjectConfig => ({
	apiUrl: "https://api.example.com",
	account: "acme",
	board: "board-1",
	flow: {
		columns: {
			todo: "todo-column",
			inProgress: "inprogress-column",
		},
		users: {},
		wipLimit: 1,
		cacheTtlSeconds: 60,
	},
	configPath: "",
	rootDir: "/tmp",
});

const jsonResponse = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

const withMockFetch = <T>(
	response: Response,
	handler: () => Promise<T>,
): Promise<{ calls: FetchCall[]; result: T }> =>
	new Promise((resolve, reject) => {
		const calls: FetchCall[] = [];
		delete (FetchHttpClient.Fetch as unknown as { [key: string]: unknown })[
			"~effect/Context/defaultValue"
		];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
			calls.push({ input: String(input), init });
			return Promise.resolve(response);
		}) as typeof fetch;

		handler()
			.then((result) => resolve({ calls, result }))
			.catch((error) => reject(error))
			.finally(() => {
				globalThis.fetch = originalFetch;
			});
	});

const getFetchCallSummary = async (call: FetchCall) => {
	const headers = call.init?.headers ?? {};

	const method = call.init?.method || "GET";

	const url = String(call.input);

	const bodyText =
		call.init?.body === undefined
			? ""
			: typeof call.init.body === "string"
				? call.init.body
				: await new Response(call.init.body).text();

	return {
		headers: headers instanceof Headers ? headers : new Headers(headers),
		method,
		url,
		bodyText,
	};
};

test("listCards unwraps { data: [...] } and decodes card fields", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: [
			{
				id: "abc",
				number: 101,
				title: "Write docs",
				description: "Draft migration guide",
				description_html: "<h2>Draft migration guide</h2>",
				closed: true,
				assignees: [{ id: "user-1", name: "Ada" }],
				column: { id: "col", name: "TODO" },
				steps: [{ content: "Step A", completed: false }],
			},
		],
	});

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").listCards()),
	);

	expect(calls).toHaveLength(1);
	expect(result).toEqual([
		{
			id: "abc",
			number: 101,
			title: "Write docs",
			description: "Draft migration guide",
			descriptionHtml: "<h2>Draft migration guide</h2>",
			column: { id: "col", name: "TODO" },
			assignees: [{ id: "user-1", name: "Ada" }],
			steps: [{ content: "Step A", completed: false }],
			closed: true,
		},
	]);
});

test("invalid card payload fails with ApiError", async () => {
	const config = makeConfig();
	const response = jsonResponse({ data: [{ number: Number.NaN, title: "Oops" }] });
	const api = makeFetchFizzyApi(config, "token");

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(api.listCards()).catch((error) => error),
	);

	expect(calls).toHaveLength(1);
	expect(result).toBeInstanceOf(ApiError);
	expect((result as ApiError)._tag).toBe("ApiError");
});

test("non-2xx responses fail with ApiError and status", async () => {
	const config = makeConfig();
	const response = jsonResponse({ error: "failure" }, 500);

	const result = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").listCards()).catch((error) => error),
	);

	const error = result.result;
	expect(error).toBeInstanceOf(ApiError);
	expect((error as ApiError).status).toBe(500);
});

test("createCard sends generated Fizzy body", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: {
			number: 9,
			title: "Implement",
			description: "Task details",
		},
	});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(
			makeFetchFizzyApi(config, "token").createCard({
				board: "board-1",
				columnId: "todo-id",
				title: "Implement",
				description: "Task details",
			}),
		),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/cards.json");
	expect(summary.headers.get("authorization")).toBe("Bearer token");
	expect(summary.headers.get("accept")).toBe("application/json");
	expect(JSON.parse(summary.bodyText)).toEqual({
		title: "Implement",
		description: "Task details",
		board_id: "board-1",
		column_id: "todo-id",
	});
});

test("updateCardDescription uses generated PATCH card body", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(
			makeFetchFizzyApi(config, "token").updateCardDescription(12, "New description"),
		),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("PATCH");
	expect(summary.url).toContain("/acme/cards/12");
	expect(JSON.parse(summary.bodyText)).toEqual({
		description: "New description",
	});
});

test("updateStep uses generated PATCH step body", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(
			makeFetchFizzyApi(config, "token").updateStep(42, "step-1", {
				completed: false,
				content: "Plain step",
			}),
		),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("PATCH");
	expect(summary.url).toContain("/acme/cards/42/steps/step-1");
	expect(JSON.parse(summary.bodyText)).toEqual({
		completed: false,
		content: "Plain step",
	});
});

test("listColumns decodes board columns", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: [
			{ id: "c1", name: "TODO" },
			{ id: "c2", name: "INPROGRESS" },
			{ id: "c3", name: "REVIEW" },
		],
	});

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").listColumns()),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("GET");
	expect(summary.url).toContain("/acme/boards/board-1/columns.json");
	expect(result).toEqual([
		{ id: "c1", name: "TODO" },
		{ id: "c2", name: "INPROGRESS" },
		{ id: "c3", name: "REVIEW" },
	]);
});

test("closeCard uses official closure endpoint", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").closeCard(42)),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/cards/42/closure.json");
});

test("postponeCard uses official not_now endpoint", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").postponeCard(42)),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/cards/42/not_now.json");
});

test("comment sends official comment body", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").comment(42, "hello")),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/cards/42/comments.json");
	expect(JSON.parse(summary.bodyText)).toEqual({ body: "hello" });
});

test("createStep sends official step body", async () => {
	const config = makeConfig();
	const response = jsonResponse({});

	const { calls } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").createStep(42, "write tests", true)),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/cards/42/steps.json");
	expect(JSON.parse(summary.bodyText)).toEqual({
		content: "write tests",
		completed: true,
	});
});

test("createColumn extracts created id from payload", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: {
			id: "c3",
			name: "REVIEW",
		},
	});

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").createColumn("REVIEW")),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.method).toBe("POST");
	expect(summary.url).toContain("/acme/boards/board-1/columns.json");
	expect(result).toEqual({ id: "c3", name: "REVIEW" });
});

test("non-JSON responses return ApiError with status and snippet", async () => {
	const config = makeConfig();
	const response = new Response("HTTP 404 page not found", {
		status: 404,
		headers: { "content-type": "text/plain" },
	});

	const result = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").listColumns()).catch((error) => error),
	);

	const error = result.result;
	expect(error).toBeInstanceOf(ApiError);
	expect((error as ApiError).status).toBe(404);
	expect((error as ApiError).message).toContain("HTTP 404");
	expect((error as ApiError).message).not.toContain("SyntaxError");
});

test("createColumn falls back to listColumns when payload is missing", async () => {
	const config = makeConfig();
	const listResponse = jsonResponse({
		data: [
			{ id: "c1", name: "TODO" },
			{ id: "c4", name: "REVIEW" },
		],
	});

	const calls: FetchCall[] = [];
	let callIndex = 0;
	const originalFetch = globalThis.fetch;
	delete (FetchHttpClient.Fetch as unknown as { [key: string]: unknown })[
		"~effect/Context/defaultValue"
	];

	const listAndCreateResponse = async () => {
		callIndex += 1;
		if (callIndex === 1) {
			return jsonResponse({ data: { data: "unexpected" } });
		}
		if (callIndex === 2) {
			return listResponse;
		}
		return jsonResponse({ data: {} });
	};

	const withMockSequence = <T>(
		handler: () => Promise<T>,
	): Promise<{ calls: FetchCall[]; result: T }> =>
		new Promise((resolve, reject) => {
			globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
				calls.push({ input: String(input), init });
				return listAndCreateResponse();
			}) as typeof fetch;

			handler()
				.then((result) => resolve({ calls, result }))
				.catch((error) => reject(error))
				.finally(() => {
					globalThis.fetch = originalFetch;
				});
		});

	const { calls: fetchCalls, result } = await withMockSequence(() =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").createColumn("REVIEW")),
	);

	expect(fetchCalls).toHaveLength(2);
	expect(result).toEqual({ id: "c4", name: "REVIEW" });
});

test("listBoards returns decoded boards", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: [
			{ id: "board-1", name: "Project One" },
			{ id: "board-2", name: "Project Two" },
		],
	});

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").listBoards()),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.url).toBe(`${config.apiUrl}/acme/boards.json`);
	expect(result).toEqual([
		{ id: "board-1", name: "Project One" },
		{ id: "board-2", name: "Project Two" },
	]);
});

test("identity uses my namespace and skips account prefix", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: {
			user: {
				id: "user-1",
				name: "Ada",
				email: "ada@example.com",
			},
		},
	});

	const { calls, result } = await withMockFetch(response, () =>
		Effect.runPromise(makeFetchFizzyApi(config, "token").identity()),
	);

	expect(calls).toHaveLength(1);
	const summary = await getFetchCallSummary(calls[0]!);
	expect(summary.url).toBe(`${config.apiUrl}/my/identity.json`);
	expect(summary.url).not.toContain(`/acme/`);
	expect(result).toEqual({
		userId: "user-1",
		name: "Ada",
		email: "ada@example.com",
	});
});
