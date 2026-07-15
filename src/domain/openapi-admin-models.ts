import type { ParsedEndpoint, ParsedProperty } from "./openapi-models";

export type AdminOperationKind = "list" | "detail" | "create" | "update" | "delete";

export interface AdminResourceOperation {
	operationId: string;
	endpoint: ParsedEndpoint;
}

export interface AdminListQueryMapping {
	page?: string;
	offset?: string;
	limit?: string;
	search?: string;
	sort?: string;
	order?: string;
	filters: string[];
}

export interface AdminResourcePlan {
	id: string;
	label: string;
	path: string;
	idParam?: string;
	columns: ParsedProperty[];
	fields: ParsedProperty[];
	listQuery?: AdminListQueryMapping;
	operations: Partial<Record<AdminOperationKind, AdminResourceOperation>>;
}

export interface AdminPlanDiagnostic {
	code: "unsupported-operation" | "ambiguous-operation";
	message: string;
	operationId: string;
}

export interface AdminAppPlan {
	title: string;
	resources: AdminResourcePlan[];
	diagnostics: AdminPlanDiagnostic[];
}
