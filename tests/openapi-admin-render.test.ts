import { expect, test } from "bun:test";
import type { AdminAppPlan } from "../src/domain/openapi-admin-models";
import { renderAdminApp } from "../src/use-cases/openapi-admin-render";

const plan: AdminAppPlan = {
	title: "Pet Store",
	diagnostics: [],
	auth: {
		status: "needs-configuration",
		securitySchemes: [],
		candidates: { login: [], logout: [], me: [], refresh: [] },
	},
	resources: [
		{
			id: "pets",
			label: "Pets",
			path: "/pets",
			idParam: "petId",
			columns: [
				{ name: "id", tsType: "string", required: true },
				{ name: "name", tsType: "string", required: true },
			],
			fields: [
				{
					name: "name",
					tsType: "string",
					required: true,
					minLength: 2,
					maxLength: 80,
				},
			],
			listQuery: {
				page: "page",
				limit: "limit",
				search: "search",
				filters: [],
			},
			operations: {
				list: {
					operationId: "listPets",
					endpoint: {
						operationId: "listPets",
						method: "get",
						path: "/pets",
						pathParams: [],
						queryParams: [],
					},
				},
				create: {
					operationId: "createPet",
					endpoint: {
						operationId: "createPet",
						method: "post",
						path: "/pets",
						pathParams: [],
						queryParams: [],
						bodyTypeRef: "CreatePetInput",
					},
				},
				detail: {
					operationId: "getPet",
					endpoint: {
						operationId: "getPet",
						method: "get",
						path: "/pets/{petId}",
						pathParams: [{ name: "petId", typeRef: "string" }],
						queryParams: [],
					},
				},
				update: {
					operationId: "updatePet",
					endpoint: {
						operationId: "updatePet",
						method: "patch",
						path: "/pets/{petId}",
						pathParams: [{ name: "petId", typeRef: "string" }],
						queryParams: [],
						bodyTypeRef: "UpdatePetInput",
					},
				},
				delete: {
					operationId: "deletePet",
					endpoint: {
						operationId: "deletePet",
						method: "delete",
						path: "/pets/{petId}",
						pathParams: [{ name: "petId", typeRef: "string" }],
						queryParams: [],
					},
				},
			},
		},
	],
};

test("renders native Next.js App Router files backed by generated query hooks", () => {
	const files = renderAdminApp(plan, "nextjs");
	const paths = files.map((file) => file.path);

	expect(paths).toContain("src/app/(admin)/page.tsx");
	expect(paths).toContain("src/components/admin/dashboard.tsx");
	expect(paths).toContain("src/app/(admin)/layout.tsx");
	expect(paths).toContain("src/app/(admin)/pets/page.tsx");
	expect(paths).toContain("src/components/admin/data-table.tsx");
	expect(paths).toContain("src/lib/api/admin-api.ts");
	expect(paths).toContain(".agents/skills/fizzyx-openapi-admin-auth/SKILL.md");
	expect(paths).toContain(".agents/skills/fizzyx-openapi-admin-development/SKILL.md");
	expect(
		files.find((file) => file.path.endsWith("fizzyx-openapi-admin-auth/SKILL.md"))?.content,
	).toContain("Do not promote a `candidate`");
	expect(
		files.find((file) => file.path.endsWith("fizzyx-openapi-admin-development/SKILL.md"))?.content,
	).toContain("preserves a modified owned file and reports it as a conflict");
	expect(files.find((file) => file.path.endsWith("lib/api/admin-api.ts"))?.content).toContain(
		"process.env.NEXT_PUBLIC_API_BASE_URL",
	);
	expect(files.find((file) => file.path.endsWith("lib/api/admin-api.ts"))?.content).toContain(
		"configureAdminApi",
	);
	const listPage = files.find((file) => file.path.endsWith("pets/page.tsx"))?.content;
	expect(listPage).toContain("useListPets");
	expect(listPage).toContain("AdminDataTable");
	expect(listPage).toContain("page: tableState.pagination.pageIndex + 1");
	expect(listPage).toContain("limit: tableState.pagination.pageSize");
	expect(listPage).toContain("search: tableState.globalFilter || undefined");
	expect(listPage).toContain('mode="server"');
	const dataTable = files.find((file) => file.path.endsWith("admin/data-table.tsx"))?.content;
	expect(dataTable).toContain("useReactTable");
	expect(dataTable).toContain("manualPagination");
	expect(dataTable).toContain("manualSorting");
	expect(dataTable).toContain("manualFiltering");
	expect(dataTable).toContain("globalFilter: string");
	expect(files.find((file) => file.path === "src/app/(admin)/page.tsx")?.content).toContain(
		"AdminDashboard",
	);
});

test("renders native TanStack Start file routes backed by generated query hooks", () => {
	const files = renderAdminApp(plan, "tanstack-start");
	const paths = files.map((file) => file.path);

	expect(paths).toContain("src/routes/_admin.tsx");
	expect(paths).toContain("src/routes/_admin/index.tsx");
	expect(paths).toContain("src/routes/_admin/pets/index.tsx");
	expect(files.find((file) => file.path.endsWith("lib/api/admin-api.ts"))?.content).toContain(
		"import.meta.env.VITE_API_BASE_URL",
	);
	const listPage = files.find((file) => file.path.endsWith("pets/index.tsx"))?.content;
	expect(listPage).toContain("createFileRoute");
	expect(listPage).toContain("useListPets");
	expect(files.find((file) => file.path === "src/routes/_admin/index.tsx")?.content).toContain(
		"AdminDashboard",
	);
});

test("renders Next.js create, detail, and edit experiences for mapped CRUD operations", () => {
	const files = renderAdminApp(plan, "nextjs");
	const paths = files.map((file) => file.path);
	const listPage = files.find((file) => file.path === "src/app/(admin)/pets/page.tsx")?.content;

	expect(paths).toContain("src/components/admin/dynamic-form.tsx");
	expect(paths).toContain("src/app/(admin)/pets/new/page.tsx");
	expect(paths).toContain("src/app/(admin)/pets/[id]/page.tsx");
	expect(paths).toContain("src/app/(admin)/pets/[id]/edit/page.tsx");
	expect(files.find((file) => file.path.endsWith("[id]/page.tsx"))?.content).toContain(
		"useDeletePet",
	);
	expect(files.find((file) => file.path.endsWith("[id]/page.tsx"))?.content).toContain(
		'router.replace("/pets")',
	);
	const dynamicForm = files.find((file) => file.path.endsWith("admin/dynamic-form.tsx"))?.content;
	expect(dynamicForm).toContain('from "@tanstack/react-form"');
	expect(dynamicForm).toContain("form.Field");
	expect(files.find((file) => file.path.endsWith("new/page.tsx"))?.content).toContain(
		"DynamicForm",
	);
	expect(files.find((file) => file.path.endsWith("[id]/edit/page.tsx"))?.content).toContain(
		"initialValue={(detail.data ?? {}) as Record<string, unknown>}",
	);
	expect(listPage).toContain("New Pets");
	expect(listPage).toContain("View");
	expect(listPage).toContain("Edit");
	expect(listPage).toContain("renderRowActions");
	expect(listPage).toContain('row["id"]');
	expect(
		files.find((file) => file.path === "src/components/admin/admin-shell.tsx")?.content,
	).toContain("SidebarProvider");
	expect(
		files.find((file) => file.path === "src/components/admin/data-table.tsx")?.content,
	).toContain("<Card");
	expect(files.find((file) => file.path.endsWith("[id]/page.tsx"))?.content).toContain(
		"AlertDialog",
	);
	expect(paths).toContain("src/components/admin/record-details.tsx");
});

test("renders TanStack Start create, detail, and edit file routes for mapped CRUD operations", () => {
	const files = renderAdminApp(plan, "tanstack-start");
	const paths = files.map((file) => file.path);
	const listRoute = files.find((file) => file.path === "src/routes/_admin/pets/index.tsx")?.content;

	expect(paths).toContain("src/routes/_admin/pets/new.tsx");
	expect(paths).toContain("src/routes/_admin/pets/$id.tsx");
	expect(paths).toContain("src/routes/_admin/pets/$id.edit.tsx");
	expect(files.find((file) => file.path.endsWith("$id.tsx"))?.content).toContain("useDeletePet");
	expect(files.find((file) => file.path.endsWith("$id.tsx"))?.content).toContain(
		'await navigate({ to: "/pets" })',
	);
	expect(listRoute).toContain("New Pets");
	expect(listRoute).toContain("View");
	expect(listRoute).toContain("Edit");
	expect(listRoute).toContain("renderRowActions");
	expect(listRoute).toContain('row["id"]');
});

const authenticatedPlan: AdminAppPlan = {
	...plan,
	auth: {
		status: "configured",
		loginPath: "/auth/login",
		securitySchemes: [{ name: "bearerAuth", type: "http", scheme: "bearer" }],
		candidates: {
			login: [{ operationId: "authLogin", score: 10, evidence: ["explicit"] }],
			logout: [],
			me: [],
			refresh: [],
		},
		config: {
			mode: "server-cookie",
			loginOperationId: "authLogin",
			usernameField: "email",
			passwordField: "password",
			accessTokenPath: "data.access_token",
			refreshTokenPath: "data.refresh_token",
			routes: { login: "/login", afterLogin: "/pets" },
		},
	},
};

test("renders server-cookie login, guard, and BFF routes for Next.js", () => {
	const files = renderAdminApp(authenticatedPlan, "nextjs");
	const paths = files.map((file) => file.path);

	expect(paths).toContain("src/app/(admin)/page.tsx");
	expect(paths).toContain("src/app/(auth)/layout.tsx");
	expect(paths).toContain("src/app/(auth)/login/page.tsx");
	expect(paths).toContain("src/app/(auth)/api/auth/login/route.ts");
	expect(paths).toContain("src/app/(auth)/api/admin/[...path]/route.ts");
	expect(files.find((file) => file.path === "src/app/(admin)/layout.tsx")?.content).toContain(
		"hasAdminSession",
	);
	expect(files.find((file) => file.path === "src/lib/api/admin-api.ts")?.content).toContain(
		'baseUrl: "/api/admin"',
	);
	expect(files.find((file) => file.path === ".env.example")?.content).toContain("API_BASE_URL=");
	expect(files.find((file) => file.path === "src/lib/auth/server.ts")?.content).toContain(
		"httpOnly: true",
	);
	expect(files.find((file) => file.path.endsWith("api/auth/login/route.ts"))?.content).toContain(
		'request.headers.get("origin")',
	);
	expect(files.find((file) => file.path.endsWith("admin-shell.tsx"))?.content).toContain(
		"Sign Out",
	);
	expect(files.find((file) => file.path.endsWith("login/page.tsx"))?.content).toContain(
		'<form method="post"',
	);
	const dashboard = files.find(
		(file) => file.path === "src/components/admin/dashboard.tsx",
	)?.content;
	expect(dashboard).toContain("Admin Overview");
	expect(dashboard).toContain("adminPlan.resources.length");
	expect(files.find((file) => file.path.endsWith("login/page.tsx"))?.content).toContain(
		"ShieldCheck",
	);
	expect(files.find((file) => file.path === "src/app/(auth)/layout.tsx")?.content).toContain(
		"Sign In · ${adminPlan.title}",
	);
});

test("renders server-cookie login, guard, and BFF routes for TanStack Start", () => {
	const files = renderAdminApp(authenticatedPlan, "tanstack-start");
	const paths = files.map((file) => file.path);

	expect(paths).toContain("src/routes/_admin/index.tsx");
	expect(paths).toContain("src/routes/login.tsx");
	expect(paths).toContain("src/routes/api/auth/login.ts");
	expect(paths).toContain("src/routes/api/admin/$.ts");
	expect(files.find((file) => file.path === "src/routes/_admin.tsx")?.content).toContain(
		"beforeLoad",
	);
	expect(files.find((file) => file.path === "src/lib/auth/server.ts")?.content).toContain(
		"createServerFn",
	);
	expect(files.find((file) => file.path === "src/lib/auth/session.server.ts")?.content).toContain(
		"@tanstack/react-start/server",
	);
	expect(files.find((file) => file.path === "src/routes/api/admin/$.ts")?.content).toContain(
		"encodeURIComponent(decodeURIComponent(segment))",
	);
	expect(files.find((file) => file.path === "src/routes/login.tsx")?.content).toContain(
		'<form method="post"',
	);
	expect(files.find((file) => file.path === "src/routes/login.tsx")?.content).toContain(
		"Sign In · ${adminPlan.title}",
	);
	const dashboard = files.find(
		(file) => file.path === "src/components/admin/dashboard.tsx",
	)?.content;
	expect(dashboard).toContain("Admin Overview");
});
