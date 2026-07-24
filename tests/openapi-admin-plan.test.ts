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

	expect(plan.version).toBe(2);
	expect(plan.defaults).toEqual({ create: "page", edit: "page", detail: "page" });
	expect(plan.resources).toHaveLength(1);
	expect(plan.resources[0]).toMatchObject({
		key: "pets",
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
	expect(plan.navigation.groups).toEqual([
		expect.objectContaining({
			id: "resources",
			label: "Resources",
			items: [expect.objectContaining({ resourceKey: "pets", path: "/pets" })],
		}),
	]);
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

test("separates operationId resource families within one tag and limits default table columns", async () => {
	const fields = Object.fromEntries(
		["id", "title", "status", "type", "city", "capacity", "start_at", "fee", "notes", "phone"].map(
			(name) => [name, { type: name === "capacity" || name === "fee" ? "number" : "string" }],
		),
	);
	const spec = await parseSpec({
		openapi: "3.1.0",
		info: { title: "Events", version: "1.0.0" },
		components: {
			schemas: {
				Activity: { type: "object", properties: fields },
				ActivityList: {
					type: "object",
					properties: {
						items: { type: "array", items: { $ref: "#/components/schemas/Activity" } },
					},
				},
			},
		},
		paths: {
			"/admin/v1/activities": {
				get: {
					operationId: "admin.activity.list",
					tags: ["Activity"],
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/ActivityList" } },
							},
						},
					},
				},
			},
			"/admin/v1/activity-categories": {
				get: { ...operation("admin.activityCategory.list", "Activity") },
			},
			"/admin/v1/activities/{id}/photos": {
				get: {
					...operation("admin.photo.list", "Activity"),
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				},
			},
			"/admin/v1/photos/{id}": {
				get: {
					...operation("admin.photo.detail", "Activity"),
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
				},
			},
		},
	});

	const plan = planAdminApp(spec);
	expect(plan.resources.map((resource) => resource.id)).toEqual([
		"activity",
		"activity-category",
		"photo",
	]);
	expect(plan.resources[0]?.columns).toHaveLength(8);
	expect(plan.resources[0]?.columns.map((column) => column.name)).toContain("title");
	expect(
		plan.resources.find((resource) => resource.id === "photo")?.operations.list,
	).toBeUndefined();
	expect(plan.navigation.groups.flatMap((group) => group.items)).not.toContainEqual(
		expect.objectContaining({ resourceKey: "photo" }),
	);
	expect(plan.diagnostics).toContainEqual(
		expect.objectContaining({
			code: "unsupported-operation",
			operationId: "admin.photo.list",
		}),
	);
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

test("infers list rows, totals, and detail records from response envelopes", async () => {
	const spec = await parseSpec({
		openapi: "3.1.0",
		info: { title: "Pets", version: "1.0.0" },
		components: {
			schemas: {
				Pet: {
					type: "object",
					required: ["id", "name"],
					properties: { id: { type: "string" }, name: { type: "string" } },
				},
				PetPage: {
					type: "object",
					properties: {
						items: { type: ["array", "null"], items: { $ref: "#/components/schemas/Pet" } },
						total: { type: "integer" },
					},
				},
				PetListEnvelope: {
					type: "object",
					properties: { code: { type: "integer" }, data: { $ref: "#/components/schemas/PetPage" } },
				},
				PetEnvelope: {
					type: "object",
					properties: { code: { type: "integer" }, data: { $ref: "#/components/schemas/Pet" } },
				},
			},
		},
		paths: {
			"/pets": {
				get: {
					operationId: "listPets",
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/PetListEnvelope" } },
							},
						},
					},
				},
			},
			"/pets/{id}": {
				get: {
					operationId: "getPet",
					parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
					responses: {
						"200": {
							description: "ok",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/PetEnvelope" } },
							},
						},
					},
				},
			},
		},
	});

	const resource = planAdminApp(spec).resources[0];
	expect(resource?.columns.map((column) => column.name)).toEqual(["id", "name"]);
	expect(resource?.data).toEqual({
		rowsPath: "data.items",
		totalPath: "data.total",
		detailPath: "data",
	});
});

test("applies metadata to resources and builds deterministic grouped navigation", async () => {
	const spec = await parseSpec({
		openapi: "3.1.0",
		info: { title: "Backoffice", version: "1.0.0" },
		tags: [
			{
				name: "Orders",
				"x-fizzyx-admin": {
					key: "commerce.orders",
					label: "Purchases",
					group: "Commerce",
					order: 20,
					icon: "shopping-cart",
					presentation: { edit: "sheet" },
					data: { rowsPath: "data.items", totalPath: "data.total" },
					permissions: { list: "orders:read" },
					actions: [{ key: "export", scope: "bulk" }],
				},
			},
			{
				name: "Customers",
				"x-fizzyx-admin": { group: "Commerce", order: 10, icon: "users" },
			},
			{ name: "Audit", "x-fizzyx-admin": { hidden: true, order: 1 } },
			{ name: "Settings" },
		],
		paths: {
			"/orders": { get: operation("listOrders", "Orders") },
			"/customers": { get: operation("listCustomers", "Customers") },
			"/audit": { get: operation("listAudit", "Audit") },
			"/settings": { get: operation("listSettings", "Settings") },
		},
	});

	const plan = planAdminApp(spec, {
		presentation: { create: "dialog", edit: "dialog", detail: "sheet" },
	});
	const orders = plan.resources.find((resource) => resource.id === "orders");

	expect(orders).toMatchObject({
		key: "commerce.orders",
		label: "Purchases",
		icon: "shopping-cart",
		presentation: { create: "dialog", edit: "sheet", detail: "sheet" },
		list: { data: { rowsPath: "data.items", totalPath: "data.total" } },
		permissions: { list: "orders:read" },
		actions: [{ key: "export", scope: "bulk" }],
	});
	expect(plan.navigation.groups.map((group) => group.label)).toEqual(["Commerce", "Resources"]);
	expect(plan.navigation.groups[0]?.items.map((item) => item.label)).toEqual([
		"Customers",
		"Purchases",
	]);
	expect(
		plan.navigation.groups.flatMap((group) => group.items).map((item) => item.label),
	).not.toContain("Audit");
});

test("preserves one-argument planning and the createMode compatibility alias", () => {
	expect(planAdminApp(petStoreSpec).resources[0]?.presentation).toEqual({
		create: "page",
		edit: "page",
		detail: "page",
	});
	expect(planAdminApp(petStoreSpec, { createMode: "dialog" }).resources[0]?.presentation).toEqual({
		create: "dialog",
		edit: "dialog",
		detail: "page",
	});
});

test("reports duplicate stable resource keys and invalid controlled icon metadata", async () => {
	const spec = await parseSpec({
		openapi: "3.1.0",
		info: { title: "Backoffice", version: "1.0.0" },
		tags: [
			{ name: "Orders", "x-fizzyx-admin": { key: "shared", icon: "sparkles" } },
			{ name: "Customers", "x-fizzyx-admin": { key: "shared" } },
		],
		paths: {
			"/orders": { get: operation("listOrders", "Orders") },
			"/customers": { get: operation("listCustomers", "Customers") },
		},
	});
	const plan = planAdminApp(spec);

	expect(plan.diagnostics).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ code: "invalid-admin-metadata", resourceKey: "shared" }),
			expect.objectContaining({ code: "ambiguous-admin-metadata", resourceKey: "shared" }),
		]),
	);
});

function operation(operationId: string, tag: string) {
	return {
		operationId,
		tags: [tag],
		responses: { "200": { description: "ok" } },
	};
}
