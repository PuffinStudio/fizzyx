import { expect, test } from "bun:test";
import { join } from "node:path";
import { createDemoServer } from "../examples/openapi-admin-auth/server";
import { parseSpec } from "../src/use-cases/openapi-parser";
import { planAdminApp } from "../src/use-cases/openapi-admin-plan";

test("local authenticated admin example is parseable and plans protected pet CRUD", async () => {
	const document = Bun.YAML.parse(
		await Bun.file(join(import.meta.dir, "../examples/openapi-admin-auth/openapi.yaml")).text(),
	) as Record<string, unknown>;
	const plan = planAdminApp(await parseSpec(document));

	expect(plan.auth).toMatchObject({
		status: "configured",
		loginPath: "/auth/login",
		config: { loginOperationId: "authLogin", meOperationId: "authMe" },
	});
	expect(plan.resources).toHaveLength(1);
	expect(plan.resources[0]).toMatchObject({
		id: "pets",
		operations: {
			list: { operationId: "listPets" },
			create: { operationId: "createPet" },
			detail: { operationId: "getPet" },
			update: { operationId: "updatePet" },
			delete: { operationId: "deletePet" },
		},
	});
});

test("local demo API rejects bad credentials and protects pets", async () => {
	const server = createDemoServer(0);
	try {
		const badLogin = await fetch(new URL("/auth/login", server.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com", password: "wrong" }),
		});
		expect(badLogin.status).toBe(401);

		const unauthorized = await fetch(new URL("/pets", server.url));
		expect(unauthorized.status).toBe(401);

		const login = await fetch(new URL("/auth/login", server.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: "admin@example.com", password: "admin123" }),
		});
		const payload = (await login.json()) as { access_token: string };
		const pets = await fetch(new URL("/pets", server.url), {
			headers: { authorization: `Bearer ${payload.access_token}` },
		});

		expect(login.status).toBe(200);
		expect(pets.status).toBe(200);
		expect(await pets.json()).toEqual([
			{ id: "1", name: "Mochi", status: "available" },
			{ id: "2", name: "Nori", status: "adopted" },
		]);
	} finally {
		server.stop(true);
	}
});
