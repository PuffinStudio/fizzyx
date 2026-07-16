import { expect, test } from "bun:test";
import type { AdminAppPlan } from "../src/domain/openapi-admin-models";
import { renderAdminApp } from "../src/use-cases/openapi-admin-render";

const plan: AdminAppPlan = {
	version: 2,
	title: "Pet Store",
	defaults: { create: "page", edit: "page", detail: "page" },
	navigation: {
		groups: [
			{
				id: "inventory",
				label: "Inventory",
				order: 10,
				items: [{ resourceKey: "pets", label: "Pets", path: "/pets", order: 10, icon: "database" }],
			},
		],
	},
	diagnostics: [],
	auth: {
		status: "needs-configuration",
		securitySchemes: [],
		candidates: { login: [], logout: [], me: [], refresh: [] },
	},
	resources: [
		{
			key: "pets",
			id: "pets",
			label: "Pets",
			path: "/pets",
			idParam: "petId",
			presentation: { create: "page", edit: "page", detail: "page" },
			columns: [
				{ name: "id", tsType: "string", required: true },
				{ name: "name", tsType: "string", required: true },
				{ name: "status", tsType: "string", required: true },
			],
			fields: [
				{
					name: "name",
					tsType: "string",
					required: true,
					minLength: 2,
					maxLength: 80,
				},
				{
					name: "status",
					tsType: "string",
					required: true,
					enumValues: ["available", "pending", "adopted"],
				},
			],
			forms: {
				create: [
					{ name: "name", tsType: "string", required: true, minLength: 2, maxLength: 80 },
					{
						name: "status",
						tsType: "string",
						required: true,
						enumValues: ["available", "pending", "adopted"],
					},
					{
						name: "tags",
						tsType: "string[]",
						required: false,
						kind: "array",
						items: { name: "item", tsType: "string", required: true, kind: "string" },
					},
					{
						name: "profile",
						tsType: "Profile",
						required: false,
						kind: "object",
						properties: [{ name: "nickname", tsType: "string", required: true, kind: "string" }],
					},
				],
				update: [{ name: "name", tsType: "string", required: true }],
			},
			listQuery: {
				page: "page",
				limit: "limit",
				search: "search",
				filters: ["status"],
				filterFields: [
					{
						name: "status",
						type: "select",
						options: ["available", "pending", "adopted"],
					},
				],
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
	expect(paths).toContain("src/components/admin/theme-provider.tsx");
	expect(paths).toContain("src/components/admin/theme-toggle.tsx");
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
	expect(listPage).toContain('status: tableState.columnFilters.find(({ id }) => id === "status")');
	expect(listPage).toContain('"filter":{"name":"status","type":"select"');
	expect(listPage).toContain("searchable");
	expect(listPage).toContain('mode="server"');
	const dataTable = files.find((file) => file.path.endsWith("admin/data-table.tsx"))?.content;
	expect(dataTable).toContain("useReactTable");
	expect(dataTable).toContain("manualPagination");
	expect(dataTable).toContain("manualSorting");
	expect(dataTable).toContain("manualFiltering");
	expect(dataTable).toContain("globalFilter: string");
	expect(dataTable).toContain("AdminTableFilterDefinition");
	expect(dataTable).toContain("filter.options");
	expect(
		files.find((file) => file.path === "src/components/admin/dynamic-form.tsx")?.content,
	).toContain("noValidate");
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
	expect(paths).toContain("src/components/admin/inline-delete-confirm.tsx");
	expect(paths).toContain("src/generated/admin/forms/pets.ts");
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
	expect(dynamicForm).toContain('from "@/components/ui/autoform"');
	expect(dynamicForm).toContain('from "@autoform/zod"');
	const schemas = files.find((file) => file.path === "src/generated/admin/forms/pets.ts")?.content;
	expect(schemas).toContain('import * as z from "zod"');
	expect(schemas).toContain("export const createPetsSchema");
	expect(schemas).toContain('z.enum(["available","pending","adopted"])');
	expect(schemas).toContain('fieldType: "select"');
	expect(schemas).toContain("tags: z.array(z.string()");
	expect(schemas).toContain("profile: z.object({ nickname: z.string()");
	expect(files.find((file) => file.path.endsWith("new/page.tsx"))?.content).toContain(
		"createPetsSchema",
	);
	expect(files.find((file) => file.path.endsWith("[id]/edit/page.tsx"))?.content).toContain(
		"initialValue={(detail.data ?? {}) as unknown as Record<string, unknown>}",
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
		"InlineDeleteConfirm",
	);
	expect(
		files.find((file) => file.path === "src/components/admin/inline-delete-confirm.tsx")?.content,
	).toContain("Confirm delete");
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

test("renders create actions as dialogs when configured", () => {
	for (const framework of ["nextjs", "tanstack-start"] as const) {
		const files = renderAdminApp(plan, framework, { createMode: "dialog" });
		const listPath =
			framework === "nextjs" ? "src/app/(admin)/pets/page.tsx" : "src/routes/_admin/pets/index.tsx";
		const createPath =
			framework === "nextjs"
				? "src/app/(admin)/pets/new/page.tsx"
				: "src/routes/_admin/pets/new.tsx";
		expect(files.find((file) => file.path === listPath)?.content).toContain("CreateResourceDialog");
		expect(files.find((file) => file.path === listPath)?.content).toContain("EditPetsDialog");
		expect(files.map((file) => file.path)).not.toContain(createPath);
		const editPath =
			framework === "nextjs"
				? "src/app/(admin)/pets/[id]/edit/page.tsx"
				: "src/routes/_admin/pets/$id.edit.tsx";
		expect(files.map((file) => file.path)).not.toContain(editPath);
		expect(files.map((file) => file.path)).toContain(
			"src/components/admin/resources/pets-edit-dialog.tsx",
		);
	}
});

test("renders independent create dialog, edit sheet, and canonical detail page surfaces", () => {
	const mixedPlan: AdminAppPlan = {
		...plan,
		defaults: { create: "dialog", edit: "sheet", detail: "page" },
		resources: plan.resources.map((resource) => ({
			...resource,
			presentation: { create: "dialog", edit: "sheet", detail: "page" },
		})),
	};

	for (const framework of ["nextjs", "tanstack-start"] as const) {
		const files = renderAdminApp(mixedPlan, framework);
		const paths = files.map((file) => file.path);
		const listPath =
			framework === "nextjs" ? "src/app/(admin)/pets/page.tsx" : "src/routes/_admin/pets/index.tsx";
		const detailPath =
			framework === "nextjs"
				? "src/app/(admin)/pets/[id]/page.tsx"
				: "src/routes/_admin/pets/$id.tsx";
		const editPagePath =
			framework === "nextjs"
				? "src/app/(admin)/pets/[id]/edit/page.tsx"
				: "src/routes/_admin/pets/$id.edit.tsx";
		const list = files.find((file) => file.path === listPath)?.content;
		const sheet = files.find(
			(file) => file.path === "src/components/admin/resources/pets-edit-sheet.tsx",
		)?.content;

		expect(list).toContain("CreateResourceDialog");
		expect(list).toContain("EditPetsSheet");
		expect(paths).toContain("src/components/admin/resources/pets-edit-sheet.tsx");
		expect(sheet).toContain('mode="sheet"');
		expect(sheet).toContain("ResourceForm");
		expect(paths).not.toContain(editPagePath);
		expect(paths).toContain(detailPath);
	}
});

test("serializes grouped navigation and v2 presentation metadata", () => {
	const files = renderAdminApp(plan, "nextjs");
	const generatedPlan = files.find((file) => file.path === "src/generated/admin-plan.ts")?.content;
	const shell = files.find((file) => file.path === "src/components/admin/admin-shell.tsx")?.content;

	expect(generatedPlan).toContain('"version": 2');
	expect(generatedPlan).toContain('"navigation"');
	expect(generatedPlan).toContain('"label": "Inventory"');
	expect(generatedPlan).toContain('"resourceKey": "pets"');
	expect(generatedPlan).toContain('"presentation"');
	expect(shell).toContain("adminPlan.navigation.groups.map");
	expect(shell).toContain("AdminNavigation");
});

test("legacy createMode page overrides resource dialog and sheet presentation", () => {
	const resource = plan.resources[0];
	if (!resource) throw new Error("expected pets resource");
	const mixedPlan: AdminAppPlan = {
		...plan,
		resources: [
			{ ...resource, presentation: { create: "dialog", edit: "sheet", detail: "sheet" } },
		],
	};
	const paths = renderAdminApp(mixedPlan, "nextjs", { createMode: "page" }).map(
		(file) => file.path,
	);

	expect(paths).toContain("src/app/(admin)/pets/new/page.tsx");
	expect(paths).toContain("src/app/(admin)/pets/[id]/edit/page.tsx");
	expect(paths).toContain("src/app/(admin)/pets/[id]/page.tsx");
	expect(paths).not.toContain("src/components/admin/resources/pets-edit-sheet.tsx");
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
	expect(files.find((file) => file.path.endsWith("login-screen.tsx"))?.content).toContain(
		'<form method="post"',
	);
	const dashboard = files.find(
		(file) => file.path === "src/components/admin/dashboard.tsx",
	)?.content;
	expect(dashboard).toContain("Admin Overview");
	expect(dashboard).toContain("adminPlan.resources.length");
	expect(files.find((file) => file.path.endsWith("login-screen.tsx"))?.content).toContain(
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
	expect(files.find((file) => file.path.endsWith("login-screen.tsx"))?.content).toContain(
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
