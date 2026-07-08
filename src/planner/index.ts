import { serve } from "bun";
import { Effect } from "effect";
import { plannerRoute } from "./planner-html";
import {
	loadPlannerSnapshotForRequest,
	loadPlannerSnapshot,
	loadPlannerContext,
	setPlannerCardDeadline,
} from "../use-cases/planner-service";
import { Live as ConfigRepoLive, makeBunConfigRepository } from "../adapters/bun-config-repository";
import { loadAppConfig } from "../adapters/app-config";
import { homedir } from "os";
import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

export type PlannerServerOptions = {
	readonly port?: number;
};

export const DEFAULT_PLANNER_PORT = 24512;
const plannerSnapshotRefreshes = new Map<string, Promise<void>>();

const parsePortFromArgs = (args: string[]): number | undefined => {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === undefined) {
			continue;
		}
		if (arg === "--port") {
			const rawPort = args[i + 1];
			if (rawPort === undefined) {
				continue;
			}

			const value = Number.parseInt(rawPort, 10);
			if (Number.isFinite(value)) {
				return value;
			}
		}

		if (arg.startsWith("--port=")) {
			const value = Number.parseInt(arg.slice("--port=".length), 10);
			if (Number.isFinite(value)) {
				return value;
			}
		}
	}

	return undefined;
};

const refreshPlannerSnapshotInBackground = (snapshot: { account: string; board: string }) => {
	const key = `${snapshot.account}:${snapshot.board}`;
	if (plannerSnapshotRefreshes.has(key)) return;

	const refresh = Effect.runPromise(
		loadPlannerSnapshot({ boardId: snapshot.board }).pipe(Effect.provide(ConfigRepoLive)),
	)
		.then(() => undefined)
		.finally(() => {
			plannerSnapshotRefreshes.delete(key);
		});
	plannerSnapshotRefreshes.set(key, refresh);
	refresh.catch(() => undefined);
};

const SELF_MESSAGES_DIR = join(homedir(), ".config", "fizzyx", "self-messages");

const readSelfMessages = (userId: string): SelfMessageRecord[] => {
	try {
		const filePath = join(SELF_MESSAGES_DIR, `${sanitizeId(userId)}.json`);
		if (!existsSync(filePath)) return [];
		const raw = readFileSync(filePath, "utf-8");
		return JSON.parse(raw) as SelfMessageRecord[];
	} catch {
		return [];
	}
};

const writeSelfMessages = (userId: string, messages: SelfMessageRecord[]): void => {
	const dir = SELF_MESSAGES_DIR;
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const filePath = join(dir, `${sanitizeId(userId)}.json`);
	writeFileSync(filePath, JSON.stringify(messages, null, 2));
};

interface SelfMessageRecord {
	readonly id: string;
	readonly encrypted: boolean;
	readonly encryptedPayload: { readonly iv: string; readonly ciphertext: string };
	readonly type: string;
	readonly createdAt: string;
}

const sanitizeId = (id: string): string => id.replace(/[^a-zA-Z0-9_-]/g, "_");

export const startPlannerServer = async (
	options: PlannerServerOptions = {},
): Promise<Bun.Server<unknown>> => {
	const port =
		typeof options.port === "number" && Number.isInteger(options.port)
			? options.port
			: DEFAULT_PLANNER_PORT;

	const server = serve({
		port,
		idleTimeout: 120,
		routes: {
			"/api/planner/avatar": async (req) => proxyAvatar(req),

			"/api/planner/config": async () => plannerConfigResponse(),

			"/api/planner/context": async () =>
				plannerJsonResponse(loadPlannerContext().pipe(Effect.provide(ConfigRepoLive))),

			"/api/planner/snapshot": async (req) => {
				const requestUrl = new URL(req.url);
				const requestIsFresh = requestUrl.searchParams.get("fresh") === "1";
				const boardId = cleanQueryValue(requestUrl.searchParams.get("board"));
				return plannerJsonResponse(
					loadPlannerSnapshotForRequest({ fresh: requestIsFresh, boardId })
						.pipe(Effect.provide(ConfigRepoLive))
						.pipe(
							Effect.map((decision) => {
								if (decision.triggerBackgroundRefresh) {
									refreshPlannerSnapshotInBackground(decision.snapshot);
								}
								return decision.snapshot;
							}),
						),
				);
			},

			"/api/planner/health": async (req) => {
				const requestUrl = new URL(req.url);
				const boardId = cleanQueryValue(requestUrl.searchParams.get("board"));
				return plannerJsonResponse(
					loadPlannerSnapshot({ boardId }).pipe(
						Effect.provide(ConfigRepoLive),
						Effect.map((snapshot) => ({
							generatedAt: snapshot.generatedAt,
							health: snapshot.health,
							recommendations: snapshot.recommendations,
						})),
					),
				);
			},

			"/api/planner/update-deadline": {
				POST: async (req) => {
					let cardNumber: number | undefined;
					let deadline: string | undefined;
					let boardId: string | undefined;
					try {
						const body = (await req.json()) as {
							cardNumber?: unknown;
							deadline?: unknown;
							board?: unknown;
						};
						if (typeof body.cardNumber === "number" && Number.isInteger(body.cardNumber)) {
							cardNumber = body.cardNumber;
						}
						if (typeof body.deadline === "string") {
							deadline = body.deadline;
						}
						if (typeof body.board === "string" && body.board.trim().length > 0) {
							boardId = body.board.trim();
						}
					} catch {}

					if (cardNumber === undefined) {
						return new Response(JSON.stringify({ error: "Invalid cardNumber" }), { status: 400 });
					}

					return plannerJsonResponse(
						setPlannerCardDeadline({ cardNumber, deadline, boardId }).pipe(
							Effect.provide(ConfigRepoLive),
						),
					);
				},
			},

			"/api/chat/self-messages": {
				GET: async (req) => {
					const url = new URL(req.url);
					const userId = url.searchParams.get("userId");
					if (!userId)
						return new Response(JSON.stringify({ error: "Missing userId" }), { status: 400 });
					const messages = readSelfMessages(userId);
					return Response.json(messages);
				},
				POST: async (req) => {
					let body: {
						userId?: string;
						id?: string;
						encrypted?: boolean;
						encryptedPayload?: { iv: string; ciphertext: string };
						type?: string;
						createdAt?: string;
					};
					try {
						body = (await req.json()) as typeof body;
					} catch {
						return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
					}
					if (
						!body.userId ||
						!body.id ||
						!body.encryptedPayload?.iv ||
						!body.encryptedPayload?.ciphertext
					) {
						return new Response(
							JSON.stringify({ error: "Missing userId, id, or encryptedPayload" }),
							{ status: 400 },
						);
					}
					const messages = readSelfMessages(body.userId);
					if (!messages.some((m) => m.id === body.id)) {
						messages.push({
							id: body.id,
							encrypted: true,
							encryptedPayload: {
								iv: body.encryptedPayload.iv,
								ciphertext: body.encryptedPayload.ciphertext,
							},
							type: (body.type as string) ?? "text",
							createdAt: body.createdAt ?? new Date().toISOString(),
						});
						writeSelfMessages(body.userId, messages);
					}
					return Response.json({ ok: true });
				},
			},

			// Serve planner frontend and SPA fallback.
			"/*": plannerRoute,
		},

		development: process.env.NODE_ENV !== "production" && {
			// Enable browser hot reloading in development
			hmr: true,

			// Echo console logs from the browser to the server
			console: true,
		},
	});

	console.log(`🚀 Planner service running at ${server.url}`);

	return server;
};

const plannerConfigResponse = async (): Promise<Response> => {
	try {
		return Response.json(await loadAppConfig());
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		return Response.json({ error: message }, { status: 400 });
	}
};

const cleanQueryValue = (value: string | null): string | undefined => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const plannerJsonResponse = async <A>(effect: Effect.Effect<A, unknown>): Promise<Response> => {
	try {
		return Response.json(await Effect.runPromise(effect));
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		const status = message.includes("No .fizzy") || message.includes("No board") ? 400 : 502;
		return Response.json({ error: message }, { status });
	}
};

const proxyAvatar = async (req: Request): Promise<Response> => {
	const requestUrl = new URL(req.url);
	const source = requestUrl.searchParams.get("url");
	if (!source) return new Response("Missing url", { status: 400 });

	let avatarUrl: URL;
	try {
		avatarUrl = new URL(source);
	} catch {
		return new Response("Invalid url", { status: 400 });
	}

	if (avatarUrl.protocol !== "https:" && avatarUrl.protocol !== "http:") {
		return new Response("Unsupported url", { status: 400 });
	}

	let token: string | undefined;
	try {
		const repo = makeBunConfigRepository();
		const config = await Effect.runPromise(repo.loadProjectConfig());
		const creds = await Effect.runPromise(repo.loadCredentials(config.account));
		token = creds.token;
	} catch {}

	try {
		const headers: Record<string, string> = {};
		if (token) headers["Authorization"] = `Bearer ${token}`;
		const upstream = await fetch(avatarUrl, { headers, redirect: "follow" });
		if (!upstream.ok || !upstream.body) return new Response("Avatar unavailable", { status: 502 });
		const contentType = upstream.headers.get("content-type") || "image/*";
		return new Response(upstream.body, {
			headers: {
				"cache-control": "public, max-age=3600",
				"content-type": contentType,
			},
		});
	} catch {
		return new Response("Avatar unavailable", { status: 502 });
	}
};

if (import.meta.main) {
	await startPlannerServer({
		port: parsePortFromArgs(process.argv.slice(2)) ?? DEFAULT_PLANNER_PORT,
	});
}
