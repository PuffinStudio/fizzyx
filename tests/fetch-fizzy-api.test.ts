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

test("createCard sends JSON body and auth/accept headers", async () => {
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
		board_id: "board-1",
		title: "Implement",
		description: "Task details",
	});
});

test("listColumns decodes board columns", async () => {
	const config = makeConfig();
	const response = jsonResponse({
		data: [
			{ id: "c1", name: "TODO" },
			{ id: "c2", name: "INPROGRESS" },
			{ id: "c3", name: "DONE" },
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
		{ id: "c3", name: "DONE" },
	]);
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
