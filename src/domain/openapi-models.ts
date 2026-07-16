export interface OpenApiGenConfig {
	input: string;
	output: string;
	client: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	posthook?: string;
	shareRuntime?: boolean;
	headers?: Record<string, string>;
	stateManagement?: string;
}

export interface OpenApiProjectConfig {
	posthook?: string;
	entries?: OpenApiGenConfig[];
	admin?: OpenApiAdminProjectConfig;
}

export interface OpenApiAdminProjectConfig {
	input?: string;
	output?: string;
	framework?: "nextjs" | "tanstack-start";
	preset?: string;
	createMode?: "page" | "dialog";
	presentation?: Partial<AdminPresentationDefaults>;
	auth?: ParsedAdminAuthConfig;
}

export type AdminSurface = "page" | "dialog" | "sheet";

export interface AdminPresentationDefaults {
	create: AdminSurface;
	edit: AdminSurface;
	detail: AdminSurface;
	[key: string]: unknown;
}

export interface GenFileOptions {
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
}

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options";

export interface ParsedSpec {
	title: string;
	version: string;
	endpoints: ParsedEndpoint[];
	types: Record<string, ParsedTypeDef>;
	securitySchemes?: ParsedSecurityScheme[];
	security?: ParsedSecurityRequirement[];
	admin?: ParsedAdminConfig;
	tags?: ParsedOpenApiTag[];
	adminMetadataDiagnostics?: ParsedAdminMetadataDiagnostic[];
}

export interface ParsedAdminMetadataDiagnostic {
	code: "invalid-admin-metadata" | "ambiguous-admin-metadata";
	message: string;
	tag?: string;
}

export interface ParsedAdminDataMapping {
	rowsPath?: string;
	totalPath?: string;
	detailPath?: string;
	[key: string]: unknown;
}

export interface ParsedAdminPermissionDescriptor {
	list?: string;
	detail?: string;
	create?: string;
	update?: string;
	delete?: string;
	[key: string]: unknown;
}

export interface ParsedAdminActionDescriptor {
	key: string;
	label?: string;
	operationId?: string;
	scope?: "resource" | "row" | "bulk";
	permission?: string;
	presentation?: AdminSurface;
	[key: string]: unknown;
}

export interface ParsedAdminTagMetadata {
	key?: string;
	label?: string;
	group?: string;
	order?: number;
	icon?: string;
	hidden?: boolean;
	presentation?: Partial<AdminPresentationDefaults>;
	data?: ParsedAdminDataMapping;
	permissions?: ParsedAdminPermissionDescriptor;
	actions?: ParsedAdminActionDescriptor[];
}

export interface ParsedOpenApiTag {
	name: string;
	description?: string;
	admin?: ParsedAdminTagMetadata;
}

export interface ParsedSecurityScheme {
	name: string;
	type: "apiKey" | "http" | "oauth2" | "openIdConnect" | "mutualTLS";
	scheme?: string;
	bearerFormat?: string;
	in?: "query" | "header" | "cookie";
	parameterName?: string;
}

export type ParsedSecurityRequirement = string[];

export type AdminAuthMode = "server-cookie" | "upstream-cookie";

export interface ParsedAdminAuthConfig {
	mode: AdminAuthMode;
	loginOperationId: string;
	logoutOperationId?: string;
	meOperationId?: string;
	refreshOperationId?: string;
	usernameField?: string;
	passwordField?: string;
	accessTokenPath?: string;
	refreshTokenPath?: string;
	expiresInPath?: string;
	routes: {
		login: string;
		afterLogin: string;
	};
}

export interface ParsedAdminConfig {
	auth?: ParsedAdminAuthConfig;
}

export interface ParsedEndpoint {
	operationId: string;
	method: HttpMethod;
	path: string;
	tags?: string[];
	summary?: string;
	description?: string;
	pathParams: PathParam[];
	queryParams: QueryParam[];
	bodyTypeRef?: string;
	responseTypeRef?: string;
	bodyContentType?: "json" | "multipart";
	responseContentType?: "json" | "binary";
	security?: ParsedSecurityRequirement[];
}

export interface PathParam {
	name: string;
	typeRef: string;
	description?: string;
}

export interface QueryParam {
	name: string;
	typeRef: string;
	required: boolean;
	description?: string;
	format?: string;
	enumValues?: Array<string | number | boolean>;
}

export interface ParsedTypeDef {
	name: string;
	kind: "interface" | "enum" | "alias";
	description?: string;
	properties?: ParsedProperty[];
	values?: string[];
	aliasType?: string;
}

export interface ParsedProperty {
	name: string;
	tsType: string;
	required: boolean;
	kind?: "string" | "number" | "integer" | "boolean" | "array" | "object";
	description?: string;
	format?: string;
	enumValues?: Array<string | number | boolean>;
	nullable?: boolean;
	items?: ParsedProperty;
	properties?: ParsedProperty[];
	minimum?: number;
	maximum?: number;
	minItems?: number;
	maxItems?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	readOnly?: boolean;
	writeOnly?: boolean;
}

export interface GeneratedFile {
	path: string;
	content: string;
	/** Seed files are created once and become user-owned immediately. */
	ownership?: "generated" | "seed-once";
}

export interface KnownGenerator {
	name: string;
	description: string;
}
