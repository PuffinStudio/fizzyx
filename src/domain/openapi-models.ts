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
	auth?: ParsedAdminAuthConfig;
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
	description?: string;
	format?: string;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	readOnly?: boolean;
	writeOnly?: boolean;
}

export interface GeneratedFile {
	path: string;
	content: string;
}

export interface KnownGenerator {
	name: string;
	description: string;
}
