import type {
	ParsedAdminAuthConfig,
	ParsedEndpoint,
	ParsedProperty,
	ParsedSecurityScheme,
} from "./openapi-models";

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
	filterFields?: AdminFilterField[];
}

export interface AdminFilterField {
	name: string;
	type: "text" | "number" | "boolean" | "date" | "select";
	options?: Array<string | number | boolean>;
}

export interface AdminResourcePlan {
	id: string;
	label: string;
	path: string;
	idParam?: string;
	columns: ParsedProperty[];
	fields: ParsedProperty[];
	forms?: {
		create?: ParsedProperty[];
		update?: ParsedProperty[];
	};
	listQuery?: AdminListQueryMapping;
	operations: Partial<Record<AdminOperationKind, AdminResourceOperation>>;
}

export interface AdminPlanDiagnostic {
	code:
		| "unsupported-operation"
		| "ambiguous-operation"
		| "auth-candidate"
		| "auth-missing"
		| "auth-unsupported";
	message: string;
	operationId?: string;
}

export type AdminAuthRole = "login" | "logout" | "me" | "refresh";

export interface AdminAuthCandidate {
	operationId: string;
	score: number;
	evidence: string[];
}

export interface AdminAuthPlan {
	status: "configured" | "needs-configuration";
	config?: ParsedAdminAuthConfig;
	loginPath?: string;
	securitySchemes: ParsedSecurityScheme[];
	candidates: Record<AdminAuthRole, AdminAuthCandidate[]>;
}

export interface AdminAppPlan {
	title: string;
	resources: AdminResourcePlan[];
	diagnostics: AdminPlanDiagnostic[];
	auth: AdminAuthPlan;
}
