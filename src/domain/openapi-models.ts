export interface OpenApiGenConfig {
	input: string;
	output: string;
	client: string;
	apiName?: string;
	typesName?: string | false;
	runtimeName?: string;
	run?: string;
}

export interface GenFileOptions {
	apiName: string;
	typesName: string | false;
	runtimeName: string;
}

export type HttpMethod = "get" | "post" | "put" | "delete" | "patch" | "head" | "options";

export interface ParsedSpec {
	title: string;
	version: string;
	endpoints: ParsedEndpoint[];
	types: Record<string, ParsedTypeDef>;
}

export interface ParsedEndpoint {
	operationId: string;
	method: HttpMethod;
	path: string;
	summary?: string;
	description?: string;
	pathParams: PathParam[];
	queryParams: QueryParam[];
	bodyTypeRef?: string;
	responseTypeRef?: string;
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
}

export interface GeneratedFile {
	path: string;
	content: string;
}

export interface KnownGenerator {
	name: string;
	description: string;
}
