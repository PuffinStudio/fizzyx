import type { AdminAppPlan, AdminResourcePlan, AdminSurface } from "../domain/openapi-admin-models";
import type { GeneratedFile } from "../domain/openapi-models";
import type { ParsedProperty } from "../domain/openapi-models";
import { toPascalCase } from "../domain/codegen-utils";
import type { AdminFramework } from "./openapi-admin-scaffold";
import { renderTemplate } from "./openapi-admin-template";
import adminShellTemplate from "../templates/openapi-admin/shared/admin-shell.tsx.txt" with { type: "text" };
import authAdminShellTemplate from "../templates/openapi-admin/shared/auth-admin-shell.tsx.txt" with { type: "text" };
import dataTableTemplate from "../templates/openapi-admin/shared/data-table.tsx.txt" with { type: "text" };
import dynamicFormTemplate from "../templates/openapi-admin/shared/dynamic-form.tsx.txt" with { type: "text" };
import dashboardTemplate from "../templates/openapi-admin/shared/dashboard.tsx.txt" with { type: "text" };
import recordDetailsTemplate from "../templates/openapi-admin/shared/record-details.tsx.txt" with { type: "text" };
import createDialogTemplate from "../templates/openapi-admin/shared/create-dialog.tsx.txt" with { type: "text" };
import editDialogTemplate from "../templates/openapi-admin/shared/edit-dialog.tsx.txt" with { type: "text" };
import inlineDeleteConfirmTemplate from "../templates/openapi-admin/shared/inline-delete-confirm.tsx.txt" with { type: "text" };
import autoformSelectFieldTemplate from "../templates/openapi-admin/shared/autoform-select-field.tsx.txt" with { type: "text" };
import themeProviderTemplate from "../templates/openapi-admin/shared/theme-provider.tsx.txt" with { type: "text" };
import themeToggleTemplate from "../templates/openapi-admin/shared/theme-toggle.tsx.txt" with { type: "text" };
import loginScreenTemplate from "../templates/openapi-admin/shared/login-screen.tsx.txt" with { type: "text" };
import queryProviderTemplate from "../templates/openapi-admin/shared/query-provider.tsx.txt" with { type: "text" };
import adminActionSurfaceTemplate from "../templates/openapi-admin/shared/admin-action-surface.tsx.txt" with { type: "text" };
import adminNavigationTemplate from "../templates/openapi-admin/shared/admin-navigation.tsx.txt" with { type: "text" };
import adminRuntimeTemplate from "../templates/openapi-admin/shared/admin-runtime.ts.txt" with { type: "text" };
import resourceFormTemplate from "../templates/openapi-admin/shared/resource-form.tsx.txt" with { type: "text" };
import dataGridTemplate from "../templates/openapi-admin/shared/data-grid.tsx.txt" with { type: "text" };
import queryStateTemplate from "../templates/openapi-admin/shared/query-state.tsx.txt" with { type: "text" };
import resourceDetailsTemplate from "../templates/openapi-admin/shared/resource-details.tsx.txt" with { type: "text" };
import resourceListTemplate from "../templates/openapi-admin/shared/resource-list.tsx.txt" with { type: "text" };
import resourceMutationTemplate from "../templates/openapi-admin/shared/resource-mutation.tsx.txt" with { type: "text" };
import adminConfigTemplate from "../templates/openapi-admin/shared/admin-config.ts.txt" with { type: "text" };
import adminRegistriesTemplate from "../templates/openapi-admin/shared/admin-registries.tsx.txt" with { type: "text" };
import adminApiTemplate from "../templates/openapi-admin/shared/admin-api.ts.txt" with { type: "text" };
import nextLayoutTemplate from "../templates/openapi-admin/nextjs/layout.tsx.txt" with { type: "text" };
import nextListTemplate from "../templates/openapi-admin/nextjs/list-page.tsx.txt" with { type: "text" };
import nextCreateTemplate from "../templates/openapi-admin/nextjs/create-page.tsx.txt" with { type: "text" };
import nextDetailTemplate from "../templates/openapi-admin/nextjs/detail-page.tsx.txt" with { type: "text" };
import nextEditTemplate from "../templates/openapi-admin/nextjs/edit-page.tsx.txt" with { type: "text" };
import nextCreateSheetTemplate from "../templates/openapi-admin/nextjs/create-sheet.tsx.txt" with { type: "text" };
import nextEditSheetTemplate from "../templates/openapi-admin/nextjs/edit-sheet.tsx.txt" with { type: "text" };
import tanstackLayoutTemplate from "../templates/openapi-admin/tanstack-start/layout-route.tsx.txt" with { type: "text" };
import tanstackListTemplate from "../templates/openapi-admin/tanstack-start/list-route.tsx.txt" with { type: "text" };
import tanstackCreateTemplate from "../templates/openapi-admin/tanstack-start/create-route.tsx.txt" with { type: "text" };
import tanstackDetailTemplate from "../templates/openapi-admin/tanstack-start/detail-route.tsx.txt" with { type: "text" };
import tanstackEditTemplate from "../templates/openapi-admin/tanstack-start/edit-route.tsx.txt" with { type: "text" };
import tanstackCreateSheetTemplate from "../templates/openapi-admin/tanstack-start/create-sheet.tsx.txt" with { type: "text" };
import tanstackEditSheetTemplate from "../templates/openapi-admin/tanstack-start/edit-sheet.tsx.txt" with { type: "text" };
import nextAuthLayoutTemplate from "../templates/openapi-admin/nextjs/auth-layout.tsx.txt" with { type: "text" };
import nextAuthServerTemplate from "../templates/openapi-admin/nextjs/auth-server.ts.txt" with { type: "text" };
import nextLoginRouteTemplate from "../templates/openapi-admin/nextjs/login-route.ts.txt" with { type: "text" };
import nextLogoutRouteTemplate from "../templates/openapi-admin/nextjs/logout-route.ts.txt" with { type: "text" };
import nextProxyRouteTemplate from "../templates/openapi-admin/nextjs/proxy-route.ts.txt" with { type: "text" };
import nextLoginPageTemplate from "../templates/openapi-admin/nextjs/login-page.tsx.txt" with { type: "text" };
import nextDashboardTemplate from "../templates/openapi-admin/nextjs/dashboard-page.tsx.txt" with { type: "text" };
import nextPublicLayoutTemplate from "../templates/openapi-admin/nextjs/public-layout.tsx.txt" with { type: "text" };
import nextRootLayoutTemplate from "../templates/openapi-admin/nextjs/root-layout.tsx.txt" with { type: "text" };
import tanstackAuthLayoutTemplate from "../templates/openapi-admin/tanstack-start/auth-layout-route.tsx.txt" with { type: "text" };
import tanstackAuthServerTemplate from "../templates/openapi-admin/tanstack-start/auth-server.ts.txt" with { type: "text" };
import tanstackAuthSessionTemplate from "../templates/openapi-admin/tanstack-start/auth-session.server.ts.txt" with { type: "text" };
import tanstackLoginApiTemplate from "../templates/openapi-admin/tanstack-start/login-api-route.ts.txt" with { type: "text" };
import tanstackLogoutApiTemplate from "../templates/openapi-admin/tanstack-start/logout-api-route.ts.txt" with { type: "text" };
import tanstackProxyTemplate from "../templates/openapi-admin/tanstack-start/proxy-route.ts.txt" with { type: "text" };
import tanstackLoginTemplate from "../templates/openapi-admin/tanstack-start/login-route.tsx.txt" with { type: "text" };
import tanstackDashboardTemplate from "../templates/openapi-admin/tanstack-start/dashboard-route.tsx.txt" with { type: "text" };
import adminAuthSkillTemplate from "../templates/openapi-admin/skills/fizzyx-openapi-admin-auth/SKILL.md" with { type: "text" };
import adminAuthSkillMetadataTemplate from "../templates/openapi-admin/skills/fizzyx-openapi-admin-auth/agents/openai.yaml" with { type: "text" };
import adminDevelopmentSkillTemplate from "../templates/openapi-admin/skills/fizzyx-openapi-admin-development/SKILL.md" with { type: "text" };
import adminDevelopmentSkillMetadataTemplate from "../templates/openapi-admin/skills/fizzyx-openapi-admin-development/agents/openai.yaml" with { type: "text" };

const identifier = (value: string): string => {
	if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
		throw new Error(`unsafe generated TypeScript identifier: ${value}`);
	}
	return value;
};

const componentName = (prefix: string, resource: AdminResourcePlan): string =>
	identifier(`${prefix}${toPascalCase(resource.id)}Page`);

const hookName = (operationId: string): string => identifier(`use${toPascalCase(operationId)}`);

const renderPlan = (plan: AdminAppPlan): GeneratedFile => ({
	path: "src/generated/admin-plan.ts",
	content: `// Generated by fizzyx. Do not edit.\n\nexport const adminPlan = ${JSON.stringify(
		{
			version: plan.version,
			title: plan.title,
			auth: plan.auth,
			defaults: plan.defaults,
			navigation: plan.navigation,
			resources: plan.resources.map(
				({ key, id, label, path, group, order, icon, hidden, presentation, operations }) => ({
					key,
					id,
					label,
					path,
					group,
					order,
					icon,
					hidden,
					presentation,
					hasList: Boolean(operations.list),
				}),
			),
			diagnostics: plan.diagnostics,
		},
		null,
		2,
	)} as const\n`,
});

const staticFile = (path: string, template: string): GeneratedFile => ({
	path,
	content: renderTemplate(template, {}),
});

const seedFile = (path: string, template: string): GeneratedFile => ({
	...staticFile(path, template),
	ownership: "seed-once",
});

const navigationAwareShellTemplate = (template: string): string => {
	if (template.includes("adminPlan.navigation.groups")) return template;
	const sidebarContent = /        <SidebarContent>[\s\S]*?        <\/SidebarContent>/;
	if (!sidebarContent.test(template)) {
		throw new Error("admin shell template is missing its navigation content boundary");
	}
	return template
		.replace("Boxes, Database,", "Boxes,")
		.replace("  SidebarGroup,\n  SidebarGroupContent,\n  SidebarGroupLabel,\n", "")
		.replace(
			'import { ThemeToggle } from "@/components/admin/theme-toggle"',
			'import { ThemeToggle } from "@/components/admin/theme-toggle"\nimport { AdminNavigation } from "@/components/admin/admin-navigation"',
		)
		.replace(
			sidebarContent,
			'        <SidebarContent className="p-2"><AdminNavigation groups={adminPlan.navigation.groups.map((group) => ({ ...group, items: group.items.map((item) => ({ key: item.resourceKey, label: item.label, href: item.path, icon: ("icon" in item ? item.icon : undefined) as never })) }))} /></SidebarContent>',
		);
};

const authTemplateValues = (plan: AdminAppPlan) => {
	const config = plan.auth.status === "configured" ? plan.auth.config : undefined;
	if (!config || !config.usernameField || !config.passwordField || !config.accessTokenPath) {
		return undefined;
	}
	const operationPath = plan.auth.loginPath;
	if (!operationPath) throw new Error("configured auth plan is missing its login path");
	return {
		FIZZYX_AUTH_CONFIG: JSON.stringify({
			loginPath: operationPath,
			accessTokenPath: config.accessTokenPath,
			refreshTokenPath: config.refreshTokenPath ?? "",
		}),
		FIZZYX_USERNAME_FIELD: JSON.stringify(config.usernameField),
		FIZZYX_PASSWORD_FIELD: JSON.stringify(config.passwordField),
		FIZZYX_USERNAME_LABEL: JSON.stringify(config.usernameField === "email" ? "Email" : "Username"),
		FIZZYX_USERNAME_TYPE: JSON.stringify(config.usernameField === "email" ? "email" : "text"),
		FIZZYX_LOGIN_ROUTE: JSON.stringify(config.routes.login),
		FIZZYX_AFTER_LOGIN_ROUTE: JSON.stringify(config.routes.afterLogin),
	};
};

const renderAuthTemplate = (template: string, values: Record<string, string>): string =>
	renderTemplate(
		template,
		Object.fromEntries(Object.entries(values).filter(([name]) => template.includes(`{{${name}}}`))),
	);

const formSchemaName = (kind: "create" | "update", resource: AdminResourcePlan): string =>
	identifier(`${kind}${toPascalCase(resource.id)}Schema`);

const formFieldLabel = (field: ParsedProperty): string =>
	field.name.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const formFieldConfig = (field: ParsedProperty): string => {
	const config: string[] = [`label: ${JSON.stringify(formFieldLabel(field))}`];
	if (field.description) config.push(`description: ${JSON.stringify(field.description)}`);
	if (field.enumValues?.length) config.push('fieldType: "select"');
	const inputType =
		field.format === "date"
			? "date"
			: field.format === "date-time"
				? "datetime-local"
				: field.format === "email"
					? "email"
					: field.format === "uri" || field.format === "url"
						? "url"
						: undefined;
	if (inputType) config.push(`inputProps: { type: ${JSON.stringify(inputType)} }`);
	return `.check(fieldConfig({ ${config.join(", ")} }))`;
};

const zodFieldSchema = (field: ParsedProperty): string => {
	const stringEnums = field.enumValues?.filter(
		(value): value is string => typeof value === "string",
	);
	let schema: string;
	if (stringEnums && stringEnums.length === field.enumValues?.length && stringEnums.length > 0) {
		schema = `z.enum(${JSON.stringify(stringEnums)})`;
	} else if (field.kind === "array" || field.tsType.endsWith("[]")) {
		schema = `z.array(${field.items ? zodFieldSchema({ ...field.items, required: true }) : "z.unknown()"})`;
		if (field.minItems !== undefined) schema += `.min(${field.minItems})`;
		if (field.maxItems !== undefined) schema += `.max(${field.maxItems})`;
	} else if (field.kind === "object" || field.properties) {
		const shape = (field.properties ?? [])
			.filter((property) => !property.readOnly)
			.map((property) => `${propertyKey(property.name)}: ${zodFieldSchema(property)}`)
			.join(", ");
		schema = `z.object({ ${shape} })`;
	} else if (field.kind === "boolean" || field.tsType.includes("boolean")) {
		schema = "z.boolean()";
	} else if (
		field.kind === "number" ||
		field.kind === "integer" ||
		field.tsType.includes("number")
	) {
		schema = "z.number()";
		if (field.kind === "integer") schema += ".int()";
		if (field.minimum !== undefined) schema += `.min(${field.minimum})`;
		if (field.maximum !== undefined) schema += `.max(${field.maximum})`;
	} else {
		schema = "z.string()";
		if (field.format === "email") schema += ".email()";
		if (field.format === "uri" || field.format === "url") schema += ".url()";
		if (field.required && field.minLength === undefined) schema += ".min(1)";
		if (field.minLength !== undefined) schema += `.min(${field.minLength})`;
		if (field.maxLength !== undefined) schema += `.max(${field.maxLength})`;
		if (field.pattern) schema += `.regex(new RegExp(${JSON.stringify(field.pattern)}))`;
	}
	if (field.nullable) schema += ".nullable()";
	schema += formFieldConfig(field);
	return field.required ? schema : `${schema}.optional()`;
};

const renderFormSchemas = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const schemas: string[] = [];
	let hasFields = false;
	for (const kind of ["create", "update"] as const) {
		if (!resource.operations[kind]) continue;
		const fields = resource.forms?.[kind] ?? resource.fields;
		hasFields ||= fields.length > 0;
		const shape = fields
			.map((field) => `  ${propertyKey(field.name)}: ${zodFieldSchema(field)},`)
			.join("\n");
		schemas.push(`export const ${formSchemaName(kind, resource)} = z.object({\n${shape}\n})`);
	}
	if (!schemas.length) return undefined;
	return {
		path: `src/generated/admin/forms/${resource.id}.ts`,
		content: `// Generated by fizzyx. Do not edit.\n\nimport * as z from "zod"\n${hasFields ? 'import { fieldConfig } from "@autoform/zod"\n' : ""}\n${schemas.join("\n\n")}\n`,
	};
};

const columnsLiteral = (resource: AdminResourcePlan): string =>
	JSON.stringify(
		resource.columns.map((column) => {
			const filter = resource.listQuery?.filterFields?.find(
				(candidate) => normalizedFilterName(candidate.name) === normalizedFilterName(column.name),
			);
			return {
				key: column.name,
				label: formFieldLabel(column),
				...(filter ? { filter } : {}),
			};
		}),
	);

const normalizedFilterName = (value: string): string => value.toLowerCase().replace(/[-_]/g, "");

const hookArgs = (resource: AdminResourcePlan): string =>
	resource.operations.list?.endpoint.queryParams.length ? "({})" : "()";

const propertyKey = (value: string): string =>
	/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);

const listTableValues = (resource: AdminResourcePlan) => {
	const mapping = resource.listQuery;
	if (!mapping) {
		return {
			FIZZYX_REACT_IMPORT: "",
			FIZZYX_TABLE_TYPE_IMPORT: "",
			FIZZYX_STATE_DECLARATION: "",
			FIZZYX_HOOK_ARGS: hookArgs(resource),
			FIZZYX_TABLE_PROPS: "",
		};
	}
	const query: string[] = [];
	if (mapping.page) query.push(`${propertyKey(mapping.page)}: tableState.pagination.pageIndex + 1`);
	if (mapping.offset)
		query.push(
			`${propertyKey(mapping.offset)}: tableState.pagination.pageIndex * tableState.pagination.pageSize`,
		);
	if (mapping.limit) query.push(`${propertyKey(mapping.limit)}: tableState.pagination.pageSize`);
	if (mapping.search)
		query.push(`${propertyKey(mapping.search)}: tableState.globalFilter || undefined`);
	if (mapping.sort) query.push(`${propertyKey(mapping.sort)}: tableState.sorting[0]?.id`);
	if (mapping.order)
		query.push(
			`${propertyKey(mapping.order)}: tableState.sorting[0] ? (tableState.sorting[0].desc ? "desc" : "asc") : undefined`,
		);
	for (const filter of mapping.filters) {
		query.push(
			`${propertyKey(filter)}: tableState.columnFilters.find(({ id }) => id === ${JSON.stringify(filter)})?.value`,
		);
	}
	return {
		FIZZYX_REACT_IMPORT: 'import { useState } from "react"\n',
		FIZZYX_TABLE_TYPE_IMPORT: ", type AdminDataTableState",
		FIZZYX_STATE_DECLARATION:
			'const [tableState, setTableState] = useState<AdminDataTableState>({ pagination: { pageIndex: 0, pageSize: 20 }, sorting: [], columnFilters: [], globalFilter: "" })',
		FIZZYX_HOOK_ARGS: `({ ${query.join(", ")} } as never)`,
		FIZZYX_TABLE_PROPS: ` mode="server"${mapping.search ? " searchable" : ""} state={tableState} onStateChange={setTableState}`,
	};
};

const listResponseDataValues = (resource: AdminResourcePlan) => ({
	FIZZYX_ROWS_PATH: JSON.stringify(resource.data?.rowsPath),
	FIZZYX_TOTAL_PATH: JSON.stringify(resource.data?.totalPath),
});

const detailResponseDataValues = (resource: AdminResourcePlan) => ({
	FIZZYX_DETAIL_PATH: JSON.stringify(resource.data?.detailPath),
});

const listRowIdKey = (resource: AdminResourcePlan): string => {
	const pathParam = resource.idParam ?? "id";
	if (resource.columns.some((column) => column.name === pathParam)) return pathParam;
	return resource.columns.find((column) => column.name.toLowerCase() === "id")?.name ?? pathParam;
};

const editDialogComponentName = (resource: AdminResourcePlan): string =>
	identifier(`Edit${toPascalCase(resource.id)}Dialog`);

const createSheetComponentName = (resource: AdminResourcePlan): string =>
	identifier(`Create${toPascalCase(resource.id)}Sheet`);

const editSheetComponentName = (resource: AdminResourcePlan): string =>
	identifier(`Edit${toPascalCase(resource.id)}Sheet`);

const renderEditDialog = (
	resource: AdminResourcePlan,
	createMode: AdminCreateMode,
): GeneratedFile | undefined => {
	const update = resource.operations.update;
	if (createMode !== "dialog" || !update) return undefined;
	const detail = resource.operations.detail;
	const detailHook = detail ? hookName(detail.operationId) : undefined;
	return {
		path: `src/components/admin/resources/${resource.id}-edit-dialog.tsx`,
		content: renderTemplate(editDialogTemplate, {
			FIZZYX_HOOK_IMPORTS: [hookName(update.operationId), detailHook].filter(Boolean).join(", "),
			FIZZYX_SCHEMA_NAME: formSchemaName("update", resource),
			FIZZYX_RESOURCE_ID: resource.id,
			FIZZYX_ID_PARAM: JSON.stringify(resource.idParam ?? "id"),
			FIZZYX_COMPONENT_NAME: editDialogComponentName(resource),
			FIZZYX_FORM_COMPONENT: identifier(`${toPascalCase(resource.id)}EditForm`),
			FIZZYX_LABEL: JSON.stringify(resource.label),
			FIZZYX_DETAIL_DATA_IMPORT: detailHook
				? 'import { readAdminPath } from "@/components/admin/admin-runtime"\n'
				: "",
			FIZZYX_DETAIL_PATH_DECLARATION: detailHook
				? `const detailPath = ${JSON.stringify(resource.data?.detailPath)}`
				: "",
			FIZZYX_DETAIL_DECLARATION: detailHook ? `const detail = ${detailHook}(params as never)` : "",
			FIZZYX_DETAIL_GUARDS: detailHook
				? 'if (detail.isPending) return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>\n  if (detail.error) return <Alert variant="destructive"><AlertTitle>Unable to load record</AlertTitle><AlertDescription>{detail.error.message}</AlertDescription></Alert>'
				: "",
			FIZZYX_UPDATE_HOOK: hookName(update.operationId),
			FIZZYX_INITIAL_VALUE: detailHook
				? "(readAdminPath(detail.data, detailPath) ?? {}) as Record<string, unknown>"
				: "{}",
		}),
	};
};

type AdminCreateMode = "page" | "dialog";

interface ResourcePresentation {
	create: AdminSurface;
	edit: AdminSurface;
	detail: AdminSurface;
}

const resourcePresentation = (
	plan: AdminAppPlan,
	resource: AdminResourcePlan,
	legacyMode?: AdminCreateMode,
): ResourcePresentation =>
	legacyMode
		? { create: legacyMode, edit: legacyMode, detail: "page" }
		: {
				create: resource.presentation.create ?? plan.defaults.create,
				edit: resource.presentation.edit ?? plan.defaults.edit,
				detail: resource.presentation.detail ?? plan.defaults.detail,
			};

const createDialogValues = (resource: AdminResourcePlan, createMode: AdminSurface) => {
	const create = resource.operations.create;
	if (!create || createMode !== "dialog") {
		return {
			FIZZYX_CREATE_HOOK_IMPORT: "",
			FIZZYX_CREATE_IMPORT: "",
			FIZZYX_CREATE_FIELDS: "",
			FIZZYX_CREATE_DECLARATION: "",
		};
	}
	return {
		FIZZYX_CREATE_HOOK_IMPORT: `, ${hookName(create.operationId)}`,
		FIZZYX_CREATE_IMPORT: `import { CreateResourceDialog } from "@/components/admin/create-dialog"\nimport { ${formSchemaName("create", resource)} } from "@/generated/admin/forms/${resource.id}"\n`,
		FIZZYX_CREATE_FIELDS: "",
		FIZZYX_CREATE_DECLARATION: `const createMutation = ${hookName(create.operationId)}()`,
	};
};

const nextListNavigationValues = (
	resource: AdminResourcePlan,
	presentation: ResourcePresentation,
) => {
	const canCreate = Boolean(resource.operations.create);
	const canView = Boolean(resource.operations.detail);
	const canEdit = Boolean(resource.operations.update);
	const hasLinkActions =
		(canCreate && presentation.create === "page") ||
		canView ||
		(canEdit && presentation.edit === "page");
	const idKey = listRowIdKey(resource);
	const rowActions =
		canView || canEdit
			? ` renderRowActions={(row) => { const value = row[${JSON.stringify(idKey)}]; if (value == null) return null; const id = encodeURIComponent(String(value)); return <div className="flex items-center gap-2">${canView ? `<Link className={buttonVariants({ size: "sm", variant: "outline" })} href={\`/${resource.id}/\${id}\`}>View</Link>` : ""}${canEdit ? (presentation.edit === "dialog" ? `<${editDialogComponentName(resource)} id={id} onSaved={async () => { await query.refetch() }} />` : presentation.edit === "sheet" ? `<${editSheetComponentName(resource)} id={id} onSaved={async () => { await query.refetch() }} />` : `<Link className={buttonVariants({ size: "sm", variant: "outline" })} href={\`/${resource.id}/\${id}/edit\`}>Edit</Link>`) : ""}</div> }}`
			: "";
	return {
		FIZZYX_NAV_IMPORTS: `${hasLinkActions ? 'import Link from "next/link"\nimport { buttonVariants } from "@/components/ui/button"\n' : ""}${canEdit && presentation.edit === "dialog" ? `import { ${editDialogComponentName(resource)} } from "@/components/admin/resources/${resource.id}-edit-dialog"\n` : ""}${canEdit && presentation.edit === "sheet" ? `import { ${editSheetComponentName(resource)} } from "@/components/admin/resources/${resource.id}-edit-sheet"\n` : ""}${canCreate && presentation.create === "sheet" ? `import { ${createSheetComponentName(resource)} } from "@/components/admin/resources/${resource.id}-create-sheet"\n` : ""}`,
		FIZZYX_CREATE_ACTION: canCreate
			? presentation.create === "dialog"
				? `<CreateResourceDialog label={resourceLabel} schema={${formSchemaName("create", resource)}} pending={createMutation.isPending} error={createMutation.error} onSubmit={async (value) => { await createMutation.mutateAsync(value as never); await query.refetch() }} />`
				: presentation.create === "sheet"
					? `<${createSheetComponentName(resource)} onSaved={async () => { await query.refetch() }} />`
					: `<Link className={buttonVariants()} href=${JSON.stringify(`/${resource.id}/new`)}>New ${resource.label}</Link>`
			: "",
		FIZZYX_ROW_ACTIONS: rowActions,
	};
};

const tanstackListNavigationValues = (
	resource: AdminResourcePlan,
	presentation: ResourcePresentation,
) => {
	const canCreate = Boolean(resource.operations.create);
	const canView = Boolean(resource.operations.detail);
	const canEdit = Boolean(resource.operations.update);
	const hasLinkActions =
		(canCreate && presentation.create === "page") ||
		canView ||
		(canEdit && presentation.edit === "page");
	const idKey = listRowIdKey(resource);
	const rowActions =
		canView || canEdit
			? ` renderRowActions={(row) => { const value = row[${JSON.stringify(idKey)}]; if (value == null) return null; const id = String(value); return <div className="flex items-center gap-2">${canView ? `<Link className={buttonVariants({ size: "sm", variant: "outline" })} to=${JSON.stringify(`/${resource.id}/$id`)} params={{ id }}>View</Link>` : ""}${canEdit ? (presentation.edit === "dialog" ? `<${editDialogComponentName(resource)} id={id} onSaved={async () => { await query.refetch() }} />` : presentation.edit === "sheet" ? `<${editSheetComponentName(resource)} id={id} onSaved={async () => { await query.refetch() }} />` : `<Link className={buttonVariants({ size: "sm", variant: "outline" })} to=${JSON.stringify(`/${resource.id}/$id/edit`)} params={{ id }}>Edit</Link>`) : ""}</div> }}`
			: "";
	return {
		FIZZYX_ROUTER_IMPORTS: hasLinkActions ? ", Link" : "",
		FIZZYX_BUTTON_IMPORT: `${hasLinkActions ? 'import { buttonVariants } from "@/components/ui/button"\n' : ""}${canEdit && presentation.edit === "dialog" ? `import { ${editDialogComponentName(resource)} } from "@/components/admin/resources/${resource.id}-edit-dialog"\n` : ""}${canEdit && presentation.edit === "sheet" ? `import { ${editSheetComponentName(resource)} } from "@/components/admin/resources/${resource.id}-edit-sheet"\n` : ""}${canCreate && presentation.create === "sheet" ? `import { ${createSheetComponentName(resource)} } from "@/components/admin/resources/${resource.id}-create-sheet"\n` : ""}`,
		FIZZYX_CREATE_ACTION: canCreate
			? presentation.create === "dialog"
				? `<CreateResourceDialog label={resourceLabel} schema={${formSchemaName("create", resource)}} pending={createMutation.isPending} error={createMutation.error} onSubmit={async (value) => { await createMutation.mutateAsync(value as never); await query.refetch() }} />`
				: presentation.create === "sheet"
					? `<${createSheetComponentName(resource)} onSaved={async () => { await query.refetch() }} />`
					: `<Link className={buttonVariants()} to=${JSON.stringify(`/${resource.id}/new`)}>New ${resource.label}</Link>`
			: "",
		FIZZYX_ROW_ACTIONS: rowActions,
	};
};

const renderNextList = (
	resource: AdminResourcePlan,
	presentation: ResourcePresentation,
): GeneratedFile | undefined => {
	const operation = resource.operations.list;
	if (!operation) return undefined;
	const hook = hookName(operation.operationId);
	const tableValues = listTableValues(resource);
	return {
		path: `src/app/(admin)/${resource.id}/page.tsx`,
		content: renderTemplate(nextListTemplate, {
			FIZZYX_HOOK_NAME: hook,
			FIZZYX_COLUMNS: columnsLiteral(resource),
			FIZZYX_LABEL: JSON.stringify(resource.label),
			FIZZYX_COMPONENT_NAME: componentName("", resource),
			...nextListNavigationValues(resource, presentation),
			...createDialogValues(resource, presentation.create),
			...tableValues,
			...listResponseDataValues(resource),
		}),
	};
};

const renderNextCreate = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const operation = resource.operations.create;
	if (!operation) return undefined;
	return {
		path: `src/app/(admin)/${resource.id}/new/page.tsx`,
		content: renderTemplate(nextCreateTemplate, {
			FIZZYX_HOOK_NAME: hookName(operation.operationId),
			FIZZYX_SCHEMA_NAME: formSchemaName("create", resource),
			FIZZYX_RESOURCE_ID: resource.id,
			FIZZYX_LABEL: JSON.stringify(resource.label),
			FIZZYX_COMPONENT_NAME: componentName("New", resource),
		}),
	};
};

const detailValues = (resource: AdminResourcePlan, framework: AdminFramework) => {
	const detail = resource.operations.detail;
	if (!detail) return undefined;
	const detailHook = hookName(detail.operationId);
	const remove = resource.operations.delete;
	const deleteHook = remove ? hookName(remove.operationId) : undefined;
	const listRoute = JSON.stringify(`/${resource.id}`);
	return {
		FIZZYX_ROUTE: JSON.stringify(`/_admin/${resource.id}/$id`),
		FIZZYX_LIST_ROUTE: listRoute,
		FIZZYX_HOOK_IMPORTS: [detailHook, deleteHook].filter(Boolean).join(", "),
		FIZZYX_ID_PARAM: JSON.stringify(resource.idParam ?? "id"),
		FIZZYX_LABEL: JSON.stringify(resource.label),
		FIZZYX_COMPONENT_NAME: componentName("", resource),
		FIZZYX_DETAIL_HOOK: detailHook,
		...detailResponseDataValues(resource),
		FIZZYX_ROUTER_IMPORTS: deleteHook
			? framework === "nextjs"
				? ", useRouter"
				: ", useNavigate"
			: "",
		FIZZYX_NAV_DECLARATION: deleteHook
			? framework === "nextjs"
				? "const router = useRouter()"
				: "const navigate = useNavigate()"
			: "",
		FIZZYX_DELETE_DECLARATION: deleteHook ? `const remove = ${deleteHook}()` : "",
		FIZZYX_DELETE_IMPORTS: deleteHook
			? 'import { InlineDeleteConfirm } from "@/components/admin/inline-delete-confirm"\n'
			: "",
		FIZZYX_DELETE_BUTTON: deleteHook
			? framework === "nextjs"
				? `<InlineDeleteConfirm pending={remove.isPending} error={remove.error} onConfirm={async () => { await remove.mutateAsync(params as never); router.replace(${listRoute}); router.refresh() }} />`
				: `<InlineDeleteConfirm pending={remove.isPending} error={remove.error} onConfirm={async () => { await remove.mutateAsync(params as never); await navigate({ to: ${listRoute} }) }} />`
			: "",
		framework,
	};
};

const renderNextDetail = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const values = detailValues(resource, "nextjs");
	if (!values) return undefined;
	const { FIZZYX_ROUTE: _route, framework: _framework, ...templateValues } = values;
	return {
		path: `src/app/(admin)/${resource.id}/[id]/page.tsx`,
		content: renderTemplate(nextDetailTemplate, templateValues),
	};
};

const editValues = (resource: AdminResourcePlan) => {
	const update = resource.operations.update;
	if (!update) return undefined;
	const detail = resource.operations.detail;
	const detailHook = detail ? hookName(detail.operationId) : undefined;
	return {
		FIZZYX_ROUTE: JSON.stringify(`/_admin/${resource.id}/$id/edit`),
		FIZZYX_HOOK_IMPORTS: [hookName(update.operationId), detailHook].filter(Boolean).join(", "),
		FIZZYX_SCHEMA_NAME: formSchemaName("update", resource),
		FIZZYX_RESOURCE_ID: resource.id,
		FIZZYX_ID_PARAM: JSON.stringify(resource.idParam ?? "id"),
		FIZZYX_LABEL: JSON.stringify(resource.label),
		FIZZYX_DETAIL_DATA_IMPORT: detailHook
			? 'import { readAdminPath } from "@/components/admin/admin-runtime"\n'
			: "",
		FIZZYX_DETAIL_PATH_DECLARATION: detailHook
			? `const detailPath = ${JSON.stringify(resource.data?.detailPath)}`
			: "",
		FIZZYX_COMPONENT_NAME: componentName("Edit", resource),
		FIZZYX_DETAIL_DECLARATION: detailHook ? `const detail = ${detailHook}(params as never)` : "",
		FIZZYX_UPDATE_HOOK: hookName(update.operationId),
		FIZZYX_INITIAL_VALUE: detailHook
			? "(readAdminPath(detail.data, detailPath) ?? {}) as Record<string, unknown>"
			: "{}",
	};
};

const renderNextEdit = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const values = editValues(resource);
	if (!values) return undefined;
	const { FIZZYX_ROUTE: _route, ...templateValues } = values;
	return {
		path: `src/app/(admin)/${resource.id}/[id]/edit/page.tsx`,
		content: renderTemplate(nextEditTemplate, templateValues),
	};
};

const renderCreateSheet = (
	resource: AdminResourcePlan,
	template: string,
): GeneratedFile | undefined => {
	const operation = resource.operations.create;
	if (!operation) return undefined;
	return {
		path: `src/components/admin/resources/${resource.id}-create-sheet.tsx`,
		content: renderTemplate(template, {
			FIZZYX_HOOK_NAME: hookName(operation.operationId),
			FIZZYX_SCHEMA_NAME: formSchemaName("create", resource),
			FIZZYX_RESOURCE_ID: resource.id,
			FIZZYX_COMPONENT_NAME: createSheetComponentName(resource),
			FIZZYX_TITLE: JSON.stringify(`Create ${resource.label}`),
			FIZZYX_LABEL: resource.label,
		}),
	};
};

const renderEditSheet = (
	resource: AdminResourcePlan,
	template: string,
): GeneratedFile | undefined => {
	const values = editValues(resource);
	if (!values) return undefined;
	const {
		FIZZYX_ROUTE: _route,
		FIZZYX_COMPONENT_NAME: _component,
		FIZZYX_LABEL: _label,
		...templateValues
	} = values;
	return {
		path: `src/components/admin/resources/${resource.id}-edit-sheet.tsx`,
		content: renderTemplate(template, {
			...templateValues,
			FIZZYX_COMPONENT_NAME: editSheetComponentName(resource),
			FIZZYX_FORM_COMPONENT: identifier(`${toPascalCase(resource.id)}EditSheetForm`),
			FIZZYX_TITLE: JSON.stringify(`Edit ${resource.label}`),
			FIZZYX_DETAIL_GUARDS: resource.operations.detail
				? 'if (detail.isPending) return <div className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div>\n  if (detail.error) return <Alert variant="destructive"><AlertTitle>Unable to load record</AlertTitle><AlertDescription>{detail.error.message}</AlertDescription></Alert>'
				: "",
		}),
	};
};

const renderTanstackList = (
	resource: AdminResourcePlan,
	presentation: ResourcePresentation,
): GeneratedFile | undefined => {
	const operation = resource.operations.list;
	if (!operation) return undefined;
	const tableValues = listTableValues(resource);
	return {
		path: `src/routes/_admin/${resource.id}/index.tsx`,
		content: renderTemplate(tanstackListTemplate, {
			FIZZYX_ROUTE: JSON.stringify(`/_admin/${resource.id}/`),
			FIZZYX_HOOK_NAME: hookName(operation.operationId),
			FIZZYX_COLUMNS: columnsLiteral(resource),
			FIZZYX_LABEL: JSON.stringify(resource.label),
			FIZZYX_COMPONENT_NAME: componentName("", resource),
			...tanstackListNavigationValues(resource, presentation),
			...createDialogValues(resource, presentation.create),
			...tableValues,
			...listResponseDataValues(resource),
		}),
	};
};

const renderTanstackCreate = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const operation = resource.operations.create;
	if (!operation) return undefined;
	return {
		path: `src/routes/_admin/${resource.id}/new.tsx`,
		content: renderTemplate(tanstackCreateTemplate, {
			FIZZYX_ROUTE: JSON.stringify(`/_admin/${resource.id}/new`),
			FIZZYX_HOOK_NAME: hookName(operation.operationId),
			FIZZYX_SCHEMA_NAME: formSchemaName("create", resource),
			FIZZYX_RESOURCE_ID: resource.id,
			FIZZYX_LABEL: JSON.stringify(resource.label),
			FIZZYX_COMPONENT_NAME: componentName("New", resource),
		}),
	};
};

const renderTanstackDetail = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const values = detailValues(resource, "tanstack-start");
	if (!values) return undefined;
	const { framework: _framework, ...templateValues } = values;
	return {
		path: `src/routes/_admin/${resource.id}/$id.tsx`,
		content: renderTemplate(tanstackDetailTemplate, templateValues),
	};
};

const renderTanstackEdit = (resource: AdminResourcePlan): GeneratedFile | undefined => {
	const values = editValues(resource);
	if (!values) return undefined;
	return {
		path: `src/routes/_admin/${resource.id}/$id.edit.tsx`,
		content: renderTemplate(tanstackEditTemplate, values),
	};
};

const renderResources = (
	plan: AdminAppPlan,
	renderers: Array<(resource: AdminResourcePlan) => GeneratedFile | undefined>,
): GeneratedFile[] =>
	plan.resources.flatMap((resource) =>
		renderers.map((renderer) => renderer(resource)).filter((file): file is GeneratedFile => !!file),
	);

const routeFilePath = (route: string): string => route.replace(/^\/+|\/+$/g, "") || "index";

const renderNextAuth = (plan: AdminAppPlan): GeneratedFile[] => {
	const values = authTemplateValues(plan);
	if (!values) return [];
	const loginRoute = routeFilePath(JSON.parse(values.FIZZYX_LOGIN_ROUTE) as string);
	return [
		{
			path: "src/lib/auth/server.ts",
			content: renderAuthTemplate(nextAuthServerTemplate, values),
		},
		{
			path: "src/app/(auth)/api/auth/login/route.ts",
			content: renderAuthTemplate(nextLoginRouteTemplate, values),
		},
		staticFile("src/app/(auth)/api/auth/logout/route.ts", nextLogoutRouteTemplate),
		staticFile("src/app/(auth)/api/admin/[...path]/route.ts", nextProxyRouteTemplate),
		{
			path: `src/app/(auth)/${loginRoute}/page.tsx`,
			content: renderAuthTemplate(nextLoginPageTemplate, values),
		},
		{
			path: "src/app/(admin)/layout.tsx",
			content: renderAuthTemplate(nextAuthLayoutTemplate, values),
		},
	];
};

const renderTanstackAuth = (plan: AdminAppPlan): GeneratedFile[] => {
	const values = authTemplateValues(plan);
	if (!values) return [];
	const loginRoute = routeFilePath(JSON.parse(values.FIZZYX_LOGIN_ROUTE) as string);
	return [
		{
			path: "src/lib/auth/server.ts",
			content: renderAuthTemplate(tanstackAuthServerTemplate, values),
		},
		{
			path: "src/lib/auth/session.server.ts",
			content: renderAuthTemplate(tanstackAuthSessionTemplate, values),
		},
		{
			path: "src/routes/api/auth/login.ts",
			content: renderAuthTemplate(tanstackLoginApiTemplate, values),
		},
		staticFile("src/routes/api/auth/logout.ts", tanstackLogoutApiTemplate),
		staticFile("src/routes/api/admin/$.ts", tanstackProxyTemplate),
		{
			path: `src/routes/${loginRoute}.tsx`,
			content: renderAuthTemplate(tanstackLoginTemplate, values),
		},
		{
			path: "src/routes/_admin.tsx",
			content: renderAuthTemplate(tanstackAuthLayoutTemplate, values),
		},
	];
};

export interface RenderAdminAppOptions {
	createMode?: AdminCreateMode;
}

export const renderAdminApp = (
	plan: AdminAppPlan,
	framework: AdminFramework,
	options: RenderAdminAppOptions = {},
): GeneratedFile[] => {
	const legacyMode = options.createMode;
	const authEnabled = plan.auth.status === "configured";
	const apiBaseUrl = authEnabled
		? '"/api/admin"'
		: framework === "nextjs"
			? 'process.env.NEXT_PUBLIC_API_BASE_URL ?? ""'
			: 'import.meta.env.VITE_API_BASE_URL ?? ""';
	const shared = [
		renderPlan(plan),
		{
			path: ".env.example",
			content: authEnabled
				? "# Server-only upstream API URL (never expose tokens here)\nAPI_BASE_URL=https://api.example.com\n"
				: framework === "nextjs"
					? "NEXT_PUBLIC_API_BASE_URL=https://api.example.com\n"
					: "VITE_API_BASE_URL=https://api.example.com\n",
		},
		staticFile(".agents/skills/fizzyx-openapi-admin-auth/SKILL.md", adminAuthSkillTemplate),
		staticFile(
			".agents/skills/fizzyx-openapi-admin-auth/agents/openai.yaml",
			adminAuthSkillMetadataTemplate,
		),
		staticFile(
			".agents/skills/fizzyx-openapi-admin-development/SKILL.md",
			adminDevelopmentSkillTemplate,
		),
		staticFile(
			".agents/skills/fizzyx-openapi-admin-development/agents/openai.yaml",
			adminDevelopmentSkillMetadataTemplate,
		),
		authEnabled
			? {
					path: "src/components/admin/admin-shell.tsx",
					content: renderAuthTemplate(
						navigationAwareShellTemplate(authAdminShellTemplate),
						authTemplateValues(plan)!,
					),
				}
			: staticFile(
					"src/components/admin/admin-shell.tsx",
					navigationAwareShellTemplate(adminShellTemplate),
				),
		staticFile("src/components/admin/data-table.tsx", dataTableTemplate),
		staticFile("src/components/admin/dynamic-form.tsx", dynamicFormTemplate),
		staticFile("src/components/admin/dashboard.tsx", dashboardTemplate),
		staticFile("src/components/admin/record-details.tsx", recordDetailsTemplate),
		staticFile("src/components/admin/create-dialog.tsx", createDialogTemplate),
		staticFile("src/components/admin/inline-delete-confirm.tsx", inlineDeleteConfirmTemplate),
		staticFile("src/components/admin/theme-provider.tsx", themeProviderTemplate),
		staticFile("src/components/admin/theme-toggle.tsx", themeToggleTemplate),
		staticFile("src/components/admin/login-screen.tsx", loginScreenTemplate),
		staticFile("src/components/admin/query-provider.tsx", queryProviderTemplate),
		staticFile("src/components/admin/admin-action-surface.tsx", adminActionSurfaceTemplate),
		staticFile("src/components/admin/admin-navigation.tsx", adminNavigationTemplate),
		staticFile("src/components/admin/admin-runtime.ts", adminRuntimeTemplate),
		staticFile("src/components/admin/resource-form.tsx", resourceFormTemplate),
		staticFile("src/components/admin/data-grid.tsx", dataGridTemplate),
		staticFile("src/components/admin/query-state.tsx", queryStateTemplate),
		staticFile("src/components/admin/resource-details.tsx", resourceDetailsTemplate),
		staticFile("src/components/admin/resource-list.tsx", resourceListTemplate),
		staticFile("src/components/admin/resource-mutation.tsx", resourceMutationTemplate),
		seedFile("src/admin/config.ts", adminConfigTemplate),
		seedFile("src/admin/registries.tsx", adminRegistriesTemplate),
		staticFile(
			"src/components/ui/autoform/components/tanstack/SelectField.tsx",
			autoformSelectFieldTemplate,
		),
		...plan.resources
			.map(renderFormSchemas)
			.filter((file): file is GeneratedFile => file !== undefined),
		...plan.resources
			.map((resource) =>
				renderEditDialog(
					resource,
					resourcePresentation(plan, resource, legacyMode).edit === "dialog" ? "dialog" : "page",
				),
			)
			.filter((file): file is GeneratedFile => file !== undefined),
		{
			path: "src/lib/api/admin-api.ts",
			content: renderTemplate(adminApiTemplate, { FIZZYX_API_BASE_URL: apiBaseUrl }),
		},
	];
	if (framework === "nextjs") {
		const authFiles = renderNextAuth(plan);
		return [
			...shared,
			{
				path: "src/app/layout.tsx",
				content: renderTemplate(nextRootLayoutTemplate, {
					FIZZYX_TITLE: JSON.stringify(`${plan.title} Admin`),
				}),
			},
			...plan.resources.flatMap((resource) => {
				const presentation = resourcePresentation(plan, resource, legacyMode);
				return [
					presentation.create === "sheet"
						? renderCreateSheet(resource, nextCreateSheetTemplate)
						: undefined,
					presentation.edit === "sheet"
						? renderEditSheet(resource, nextEditSheetTemplate)
						: undefined,
				].filter((file): file is GeneratedFile => file !== undefined);
			}),
			staticFile("src/app/(admin)/page.tsx", nextDashboardTemplate),
			...(authFiles.length
				? [staticFile("src/app/(auth)/layout.tsx", nextPublicLayoutTemplate), ...authFiles]
				: [staticFile("src/app/(admin)/layout.tsx", nextLayoutTemplate)]),
			...renderResources(plan, [
				(resource) => renderNextList(resource, resourcePresentation(plan, resource, legacyMode)),
				(resource) =>
					resourcePresentation(plan, resource, legacyMode).create === "page"
						? renderNextCreate(resource)
						: undefined,
				renderNextDetail,
				(resource) =>
					resourcePresentation(plan, resource, legacyMode).edit === "page"
						? renderNextEdit(resource)
						: undefined,
			]),
		];
	}
	const authFiles = renderTanstackAuth(plan);
	return [
		...shared,
		...plan.resources.flatMap((resource) => {
			const presentation = resourcePresentation(plan, resource, legacyMode);
			return [
				presentation.create === "sheet"
					? renderCreateSheet(resource, tanstackCreateSheetTemplate)
					: undefined,
				presentation.edit === "sheet"
					? renderEditSheet(resource, tanstackEditSheetTemplate)
					: undefined,
			].filter((file): file is GeneratedFile => file !== undefined);
		}),
		staticFile("src/routes/_admin/index.tsx", tanstackDashboardTemplate),
		...(authFiles.length
			? authFiles
			: [staticFile("src/routes/_admin.tsx", tanstackLayoutTemplate)]),
		...renderResources(plan, [
			(resource) => renderTanstackList(resource, resourcePresentation(plan, resource, legacyMode)),
			(resource) =>
				resourcePresentation(plan, resource, legacyMode).create === "page"
					? renderTanstackCreate(resource)
					: undefined,
			renderTanstackDetail,
			(resource) =>
				resourcePresentation(plan, resource, legacyMode).edit === "page"
					? renderTanstackEdit(resource)
					: undefined,
		]),
	];
};
