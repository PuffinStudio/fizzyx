import type {
	ParsedAdminAuthConfig,
	AdminPresentationDefaults,
	AdminSurface,
	ParsedAdminActionDescriptor,
	ParsedAdminDataMapping,
	ParsedAdminPermissionDescriptor,
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
	key: string;
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
	group?: string;
	order?: number;
	icon?: AdminIconKey;
	hidden?: boolean;
	presentation: AdminPresentationDefaults;
	list?: AdminListPlan;
	data?: ParsedAdminDataMapping;
	permissions?: ParsedAdminPermissionDescriptor;
	actions?: ParsedAdminActionDescriptor[];
	operations: Partial<Record<AdminOperationKind, AdminResourceOperation>>;
}

export type { AdminSurface };

export type AdminIconKey =
	| "database"
	| "file"
	| "folder"
	| "home"
	| "package"
	| "settings"
	| "shield"
	| "shopping-cart"
	| "user"
	| "users";

export interface AdminListPlan {
	query?: AdminListQueryMapping;
	data?: ParsedAdminDataMapping;
	/** Additional runtime mappings may be added without changing resource identity. */
	[key: string]: unknown;
}

export interface AdminNavigationItem {
	resourceKey: string;
	label: string;
	path: string;
	order: number;
	icon?: AdminIconKey;
}

export interface AdminNavigationGroup {
	id: string;
	label: string;
	order: number;
	items: AdminNavigationItem[];
}

export interface AdminNavigationPlan {
	groups: AdminNavigationGroup[];
}

export interface AdminPlanDiagnostic {
	code:
		| "unsupported-operation"
		| "ambiguous-operation"
		| "auth-candidate"
		| "auth-missing"
		| "auth-unsupported"
		| "invalid-admin-metadata"
		| "ambiguous-admin-metadata";
	message: string;
	operationId?: string;
	tag?: string;
	resourceKey?: string;
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
	version: 2;
	title: string;
	resources: AdminResourcePlan[];
	navigation: AdminNavigationPlan;
	defaults: AdminPresentationDefaults;
	diagnostics: AdminPlanDiagnostic[];
	auth: AdminAuthPlan;
}
