import { expect, test } from "bun:test";
import type { ParsedSpec } from "../src/domain/openapi-models";
import { planAdminApp } from "../src/use-cases/openapi-admin-plan";
import { parseSpec } from "../src/use-cases/openapi-parser";

const petStoreSpec: ParsedSpec = {
	title: "Pet Store",
	version: "1.0.0",
	types: {
		Pet: {
			name: "Pet",
			kind: "interface",
			properties: [
				{ name: "id", tsType: "number", required: true },
				{ name: "name", tsType: "string", required: true },
			],
		},
		CreatePetInput: {
			name: "CreatePetInput",
			kind: "interface",
			properties: [{ name: "name", tsType: "string", required: true }],
		},
	},
	endpoints: [
		{
			operationId: "listPets",
			method: "get",
			path: "/pets",
			pathParams: [],
			queryParams: [],
			responseTypeRef: "Pet[]",
		},
		{
			operationId: "createPet",
			method: "post",
			path: "/pets",
			pathParams: [],
			queryParams: [],
			bodyTypeRef: "CreatePetInput",
			responseTypeRef: "Pet",
		},
		{
			operationId: "getPet",
			method: "get",
			path: "/pets/{petId}",
			pathParams: [{ name: "petId", typeRef: "number" }],
			queryParams: [],
			responseTypeRef: "Pet",
		},
		{
			operationId: "deletePet",
			method: "delete",
			path: "/pets/{petId}",
			pathParams: [{ name: "petId", typeRef: "number" }],
			queryParams: [],
		},
	],
};

test("plans CRUD admin pages from collection and member operations", () => {
	const plan = planAdminApp(petStoreSpec);

	expect(plan.resources).toHaveLength(1);
	expect(plan.resources[0]).toMatchObject({
		id: "pets",
		label: "Pets",
		path: "/pets",
		operations: {
			list: { operationId: "listPets" },
			create: { operationId: "createPet" },
			detail: { operationId: "getPet" },
			delete: { operationId: "deletePet" },
		},
	});
	expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "auth-missing" }));
});

test("reports strong auth candidates but does not silently enable authentication", async () => {
	const spec = await parseSpec({
		openapi: "3.0.0",
		info: { title: "Users", version: "1.0.0" },
		components: {
			schemas: {
				LoginInput: {
					type: "object",
					required: ["email", "password"],
					properties: { email: { type: "string" }, password: { type: "string" } },
				},
			},
		},
		paths: {
			"/auth/login": {
				post: {
					operationId: "authLogin",
					security: [],
					requestBody: {
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/LoginInput" } },
						},
					},
					responses: { "200": { description: "ok" } },
				},
			},
		},
	});

	const plan = planAdminApp(spec);

	expect(plan.auth.status).toBe("needs-configuration");
	expect(plan.auth.candidates.login[0]).toMatchObject({ operationId: "authLogin" });
	expect(plan.auth.candidates.login[0]!.score).toBeGreaterThanOrEqual(8);
	expect(plan.resources).toEqual([]);
	expect(plan.diagnostics).toContainEqual(
		expect.objectContaining({ code: "auth-candidate", operationId: "authLogin" }),
	);
});

test("uses an OpenAPI operation tag instead of a versioned URL prefix for the resource", async () => {
	const spec = await parseSpec({
		openapi: "3.0.0",
		info: { title: "Admin API", version: "1.0.0" },
		paths: {
			"/v1/admin/users": {
				get: {
					operationId: "listUsers",
					tags: ["Users"],
					responses: { "200": { description: "ok" } },
				},
			},
		},
	});

	const plan = planAdminApp(spec);

	expect(plan.resources[0]).toMatchObject({ id: "users", label: "Users", path: "/users" });
});

test("preserves schema constraints and excludes read-only properties from admin forms", async () => {
	const spec = await parseSpec({
		openapi: "3.0.0",
		info: { title: "Users", version: "1.0.0" },
		components: {
			schemas: {
				UserInput: {
					type: "object",
					required: ["email"],
					properties: {
						id: { type: "string", readOnly: true },
						email: { type: "string", format: "email", minLength: 3, maxLength: 80 },
					},
				},
			},
		},
		paths: {
			"/users": {
				post: {
					operationId: "createUser",
					requestBody: {
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/UserInput" } },
						},
					},
					responses: { "201": { description: "created" } },
				},
			},
		},
	});

	const plan = planAdminApp(spec);

	expect(plan.resources[0]?.fields).toEqual([
		expect.objectContaining({
			name: "email",
			format: "email",
			minLength: 3,
			maxLength: 80,
			required: true,
		}),
	]);
});

test("preserves enum choices for generated select controls and typed list filters", async () => {
	const spec = await parseSpec({
		openapi: "3.1.0",
		info: { title: "Pets", version: "1.0.0" },
		components: {
			schemas: {
				PetStatus: {
					type: "string",
					enum: ["available", "pending", "adopted"],
				},
				Pet: {
					type: "object",
					properties: { id: { type: "string" }, status: { type: "string" } },
				},
				PetInput: {
					type: "object",
					required: ["status"],
					properties: {
						status: { $ref: "#/components/schemas/PetStatus" },
					},
				},
			},
		},
		paths: {
			"/pets": {
				get: {
					operationId: "listPets",
					parameters: [
						{
							name: "status",
							in: "query",
							schema: { $ref: "#/components/schemas/PetStatus" },
						},
					],
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": {
									schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
								},
							},
						},
					},
				},
				post: {
					operationId: "createPet",
					requestBody: {
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/PetInput" } },
						},
					},
					responses: { "201": { description: "created" } },
				},
			},
		},
	});

	const resource = planAdminApp(spec).resources[0];

	expect(resource?.forms?.create).toEqual([
		expect.objectContaining({
			name: "status",
			enumValues: ["available", "pending", "adopted"],
		}),
	]);
	expect(resource?.listQuery?.filterFields).toEqual([
		{
			name: "status",
			type: "select",
			options: ["available", "pending", "adopted"],
		},
	]);
});

test("maps conventional list query parameters to server-side table state", () => {
	const spec: ParsedSpec = {
		...petStoreSpec,
		endpoints: petStoreSpec.endpoints.map((endpoint) =>
			endpoint.operationId === "listPets"
				? {
						...endpoint,
						queryParams: [
							{ name: "page", typeRef: "number", required: false },
							{ name: "page_size", typeRef: "number", required: false },
							{ name: "q", typeRef: "string", required: false },
							{ name: "sort_by", typeRef: "string", required: false },
							{ name: "sort_order", typeRef: "string", required: false },
							{ name: "name", typeRef: "string", required: false },
						],
					}
				: endpoint,
		),
	};

	const resource = planAdminApp(spec).resources[0];

	expect(resource?.listQuery).toEqual({
		page: "page",
		offset: undefined,
		limit: "page_size",
		search: "q",
		sort: "sort_by",
		order: "sort_order",
		filters: ["name"],
		filterFields: [{ name: "name", type: "text" }],
	});
});
