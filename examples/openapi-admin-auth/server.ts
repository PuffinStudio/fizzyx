const DEMO_EMAIL = "admin@example.com";
const DEMO_PASSWORD = "admin123";
const DEMO_TOKEN = "fizzyx-local-demo-token";

interface Pet {
	id: string;
	name: string;
	status: "available" | "adopted";
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

const parsePetInput = async (
	request: Request,
): Promise<Pick<Pet, "name" | "status"> | undefined> => {
	const body: unknown = await request.json().catch(() => undefined);
	if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
	const { name, status } = body as Record<string, unknown>;
	if (
		typeof name !== "string" ||
		name.trim().length < 1 ||
		name.trim().length > 80 ||
		(status !== "available" && status !== "adopted")
	) {
		return undefined;
	}
	return { name: name.trim(), status };
};

export const createDemoServer = (port = 4010) => {
	const pets = new Map<string, Pet>([
		["1", { id: "1", name: "Mochi", status: "available" }],
		["2", { id: "2", name: "Nori", status: "adopted" }],
	]);
	let nextId = 3;

	return Bun.serve({
		hostname: "127.0.0.1",
		port,
		async fetch(request) {
			const url = new URL(request.url);
			if (request.method === "POST" && url.pathname === "/auth/login") {
				const body: unknown = await request.json().catch(() => undefined);
				const credentials =
					body && typeof body === "object" && !Array.isArray(body)
						? (body as Record<string, unknown>)
						: {};
				if (credentials.email !== DEMO_EMAIL || credentials.password !== DEMO_PASSWORD) {
					return json({ error: "Invalid credentials" }, 401);
				}
				return json({ access_token: DEMO_TOKEN });
			}

			if (request.headers.get("authorization") !== `Bearer ${DEMO_TOKEN}`) {
				return json({ error: "Authentication required" }, 401);
			}
			if (request.method === "GET" && url.pathname === "/auth/me") {
				return json({ id: "local-admin", email: DEMO_EMAIL, role: "admin" });
			}
			if (url.pathname === "/pets" && request.method === "GET") {
				return json([...pets.values()]);
			}
			if (url.pathname === "/pets" && request.method === "POST") {
				const input = await parsePetInput(request);
				if (!input) return json({ error: "Invalid pet" }, 400);
				const pet = { id: String(nextId++), ...input } satisfies Pet;
				pets.set(pet.id, pet);
				return json(pet, 201);
			}

			const match = url.pathname.match(/^\/pets\/([^/]+)$/);
			if (!match) return json({ error: "Not found" }, 404);
			const id = decodeURIComponent(match[1]!);
			const pet = pets.get(id);
			if (!pet) return json({ error: "Pet not found" }, 404);
			if (request.method === "GET") return json(pet);
			if (request.method === "PATCH") {
				const input = await parsePetInput(request);
				if (!input) return json({ error: "Invalid pet" }, 400);
				const updated = { ...pet, ...input };
				pets.set(id, updated);
				return json(updated);
			}
			if (request.method === "DELETE") {
				pets.delete(id);
				return new Response(null, { status: 204 });
			}
			return json({ error: "Method not allowed" }, 405);
		},
	});
};

if (import.meta.main) {
	const server = createDemoServer(Number(process.env.PORT ?? 4010));
	console.log(`Local auth demo API: ${server.url}`);
	console.log(`Demo login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}
