import { expect, test } from "bun:test";
import actionSurface from "../src/templates/openapi-admin/shared/admin-action-surface.tsx.txt" with { type: "text" };
import config from "../src/templates/openapi-admin/shared/admin-config.ts.txt" with { type: "text" };
import dataGrid from "../src/templates/openapi-admin/shared/data-grid.tsx.txt" with { type: "text" };
import dataTable from "../src/templates/openapi-admin/shared/data-table.tsx.txt" with { type: "text" };
import navigation from "../src/templates/openapi-admin/shared/admin-navigation.tsx.txt" with { type: "text" };
import queryState from "../src/templates/openapi-admin/shared/query-state.tsx.txt" with { type: "text" };
import registries from "../src/templates/openapi-admin/shared/admin-registries.tsx.txt" with { type: "text" };
import resourceDetails from "../src/templates/openapi-admin/shared/resource-details.tsx.txt" with { type: "text" };
import resourceForm from "../src/templates/openapi-admin/shared/resource-form.tsx.txt" with { type: "text" };
import resourceList from "../src/templates/openapi-admin/shared/resource-list.tsx.txt" with { type: "text" };
import resourceMutation from "../src/templates/openapi-admin/shared/resource-mutation.tsx.txt" with { type: "text" };
import runtime from "../src/templates/openapi-admin/shared/admin-runtime.ts.txt" with { type: "text" };

test("runtime templates expose the shared component contracts", () => {
	expect(actionSurface).toContain("mode: AdminSurface");
	expect(actionSurface).toContain('mode === "sheet"');
	expect(actionSurface).toContain("@/components/ui/sheet");
	expect(dataGrid).toContain("export function DataGrid");
	expect(dataGrid).toContain("export { AdminDataTable }");
	expect(dataGrid).toContain('requireRegistryEntry<NonNullable<AdminColumnDefinition["render"]>>');
	expect(dataTable).toContain("formatAdminCell");
	expect(dataTable).toContain("Rows per page");
	expect(dataTable).toContain("ArrowUpDown");
	expect(dataTable).toContain("tableColumn.getCanSort()");
	expect(resourceForm).toContain("export function ResourceForm");
	expect(resourceMutation).toContain("export function useResourceMutation");
	expect(resourceList).toContain("export function ResourceList");
	expect(resourceDetails).toContain("export function ResourceDetails");
	expect(queryState).toContain("export function QueryState");
	expect(runtime).toContain("normalizeAdminApiError");
});

test("navigation icons use a controlled static registry", () => {
	expect(navigation).toContain(
		'export type AdminIconKey = "boxes" | "database" | "settings" | "shield" | "users"',
	);
	expect(navigation).toContain("resolveAdminIcon(item.icon)");
	expect(navigation).toContain('aria-current={active ? "page" : undefined}');
	expect(navigation).toContain("window.location.pathname");
	expect(navigation).toContain("Object.hasOwn(adminIconRegistry, key)");
	expect(navigation).not.toMatch(/import\([^)]*icon/i);
});

test("seed-once extension templates declare stable registries and ownership", () => {
	for (const registry of ["fields", "cells", "actions", "pages", "operations"]) {
		expect(registries).toContain(`${registry}:`);
	}
	expect(registries).toContain("user-owned after creation");
	expect(registries).toContain("requireRegistryEntry");
	expect(config).toContain("defineAdminConfig");
	expect(config).toContain("user-owned after creation");
});
