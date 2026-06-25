import { serve } from "bun";
import tailwind from "bun-plugin-tailwind";
import { Effect } from "effect";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	loadPlannerSnapshotForRequest,
	loadPlannerSnapshot,
	repairPlannerMetadata,
} from "../use-cases/planner-service";
import { normalizePriority } from "../use-cases/planner-transform";
import { Live as ConfigRepoLive, makeBunConfigRepository } from "../adapters/bun-config-repository";

export type PlannerServerOptions = {
	readonly port?: number;
};

export const DEFAULT_PLANNER_PORT = 24512;
const plannerSnapshotRefreshes = new Map<string, Promise<void>>();

const resolvePlannerIndexHtml = async (): Promise<URL> => {
	const candidates: URL[] = [
		new URL("./index.html", import.meta.url),
		new URL("../planner/index.html", import.meta.url),
		new URL("../src/planner/index.html", import.meta.url),
	];

	for (const candidate of candidates) {
		if (await Bun.file(candidate).exists()) {
			return candidate;
		}
	}

	throw new Error(
		`Unable to locate planner index.html. Checked: ${candidates.map((value) => value.pathname).join(", ")}`,
	);
};

type PlannerAssets = {
	readonly outdir: string;
	readonly indexPath: string;
};

const buildPlannerAssets = async (): Promise<PlannerAssets> => {
	const indexHtml = await resolvePlannerIndexHtml();
	const outdir = path.join(tmpdir(), `fizzyx-planner-${process.pid}`);
	await rm(outdir, { recursive: true, force: true });

	const result = await Bun.build({
		entrypoints: [indexHtml.pathname],
		outdir,
		plugins: [tailwind],
		target: "browser",
		minify: process.env.NODE_ENV === "production",
		define: {
			"process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
		},
	});

	if (!result.success) {
		throw new Error("Failed to build planner web assets");
	}

	const htmlOutput = result.outputs.find((output) => output.path.endsWith(".html"));
	if (htmlOutput === undefined) {
		throw new Error("Planner web build did not emit index.html");
	}

	return {
		outdir,
		indexPath: htmlOutput.path,
	};
};

const makePlannerResponseHandler = async () => {
	const { outdir, indexPath } = await buildPlannerAssets();
	const indexResponse = () =>
		new Response(Bun.file(indexPath), {
			headers: {
				"content-type": "text/html; charset=utf-8",
			},
		});

	return async (req: Request): Promise<Response> => {
		const requestUrl = new URL(req.url);
		const requestPath = decodeURIComponent(requestUrl.pathname);

		if (requestPath === "/" || requestPath === "/index.html") {
			return indexResponse();
		}

		const filePath = path.resolve(outdir, `.${requestPath}`);
		const relativePath = path.relative(outdir, filePath);
		if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
			return new Response("Not found", { status: 404 });
		}

		const maybeFile = Bun.file(filePath);
		if (await maybeFile.exists()) {
			return new Response(maybeFile);
		}

		return indexResponse();
	};
};

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

	const refresh = Effect.runPromise(loadPlannerSnapshot().pipe(Effect.provide(ConfigRepoLive)))
		.then(() => undefined)
		.finally(() => {
			plannerSnapshotRefreshes.delete(key);
		});
	plannerSnapshotRefreshes.set(key, refresh);
	refresh.catch(() => undefined);
};

export const startPlannerServer = async (
	options: PlannerServerOptions = {},
): Promise<Bun.Server<unknown>> => {
	const port =
		typeof options.port === "number" && Number.isInteger(options.port)
			? options.port
			: DEFAULT_PLANNER_PORT;
	const plannerHandler = await makePlannerResponseHandler();

	const server = serve({
		port,
		idleTimeout: 120,
		routes: {
			"/api/planner/avatar": async (req) => proxyAvatar(req),

			"/api/planner/snapshot": async (req) => {
				const requestUrl = new URL(req.url);
				const requestIsFresh = requestUrl.searchParams.get("fresh") === "1";
				return plannerJsonResponse(
					loadPlannerSnapshotForRequest({ fresh: requestIsFresh })
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

			"/api/planner/health": async () =>
				plannerJsonResponse(
					loadPlannerSnapshot().pipe(
						Effect.provide(ConfigRepoLive),
						Effect.map((snapshot) => ({
							generatedAt: snapshot.generatedAt,
							health: snapshot.health,
							recommendations: snapshot.recommendations,
						})),
					),
				),

			"/api/planner/repair-metadata": {
				POST: async (req) => {
					let apply = true;
					let defaultPriority: "p0" | "p1" | "p2" | undefined;
					let defaultType: string | undefined;
					try {
						const body = (await req.json()) as {
							apply?: boolean;
							defaultPriority?: unknown;
							defaultType?: unknown;
						};
						if (typeof body.apply === "boolean") apply = body.apply;
						if (typeof body.defaultPriority === "string") {
							defaultPriority = normalizePriority(body.defaultPriority);
						}
						if (typeof body.defaultType === "string" && body.defaultType.trim() !== "") {
							defaultType = body.defaultType.trim();
						}
					} catch {}
					return plannerJsonResponse(
						repairPlannerMetadata({ apply, defaultPriority, defaultType }).pipe(
							Effect.provide(ConfigRepoLive),
						),
					);
				},
			},

			// Serve compiled planner assets and SPA fallback.
			"/*": plannerHandler,
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
