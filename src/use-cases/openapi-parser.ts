import $RefParser from "@apidevtools/json-schema-ref-parser";
import { toPascalCase } from "../domain/codegen-utils";
import type {
	ParsedEndpoint,
	ParsedAdminConfig,
	ParsedSecurityRequirement,
	ParsedSecurityScheme,
	ParsedProperty,
	ParsedSpec,
	ParsedTypeDef,
	PathParam,
	QueryParam,
} from "../domain/openapi-models";

type SchemaNameResolver = (name: string) => string;

export async function parseSpec(doc: Record<string, unknown>): Promise<ParsedSpec> {
	const info = doc.info as Record<string, unknown> | undefined;
	const title = (info?.title as string) ?? "API";
	const version = (info?.version as string) ?? "0.0.0";
	const securitySchemes = parseSecuritySchemes(doc);
	const security = parseSecurityRequirements(doc.security);
	const admin = parseAdminConfig(doc["x-fizzyx-admin"]);

	const schemas = extractRawSchemas(doc);
	const resolveSchemaName = buildSchemaNameResolver(schemas);
	const { refMap, inlineTypes, endpointMeta } = buildSchemaRefMap(doc, resolveSchemaName);
	const propRefs = buildPropertyRefs(doc, resolveSchemaName);

	const dereferenced = (await $RefParser.dereference(JSON.parse(JSON.stringify(doc)), {
		parse: { yaml: false },
	})) as unknown as Record<string, unknown>;

	const derefSchemas = parseAllSchemas(
		dereferenced.components as Record<string, unknown> | undefined,
		propRefs,
		resolveSchemaName,
	);

	// Parse inline response/body schemas as named types so they appear in types.ts
	for (const [typeName, schema] of inlineTypes) {
		if (!derefSchemas[typeName]) {
			derefSchemas[typeName] = parseSchema(typeName, schema, propRefs, resolveSchemaName);
		}
	}

	const paths = dereferenced.paths as Record<string, unknown> | undefined;
	const endpoints = parseAllEndpoints(paths, derefSchemas, refMap, resolveSchemaName, endpointMeta);
	validateAdminAuth(admin, endpoints, security);

	return { title, version, endpoints, types: derefSchemas, securitySchemes, security, admin };
}

function validateAdminAuth(
	admin: ParsedAdminConfig | undefined,
	endpoints: ParsedEndpoint[],
	rootSecurity: ParsedSecurityRequirement[] | undefined,
): void {
	const auth = admin?.auth;
	if (!auth) return;
	const configured = [
		["loginOperationId", auth.loginOperationId],
		["logoutOperationId", auth.logoutOperationId],
		["meOperationId", auth.meOperationId],
		["refreshOperationId", auth.refreshOperationId],
	] as const;
	for (const [field, operationId] of configured) {
		if (operationId && !endpoints.some((endpoint) => endpoint.operationId === operationId)) {
			throw new Error(`x-fizzyx-admin.auth.${field} references unknown operationId ${operationId}`);
		}
	}
	const login = endpoints.find((endpoint) => endpoint.operationId === auth.loginOperationId)!;
	if (login.method !== "post") {
		throw new Error("x-fizzyx-admin.auth.loginOperationId must reference a POST operation");
	}
	if (rootSecurity?.length && login.security === undefined) {
		throw new Error(
			"configured login inherits root security; declare security: [] on the login operation",
		);
	}
	if (login.security?.length) {
		throw new Error("configured login operation must be public with security: []");
	}
	if (auth.mode === "server-cookie" && !auth.accessTokenPath) {
		throw new Error("server-cookie auth requires x-fizzyx-admin.auth.accessTokenPath");
	}
}

const object = (value: unknown, label: string): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
};

const optionalString = (source: Record<string, unknown>, key: string): string | undefined => {
	const value = source[key];
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`x-fizzyx-admin.auth.${key} must be a non-empty string`);
	}
	return value;
};

function parseAdminConfig(value: unknown): ParsedAdminConfig | undefined {
	if (value === undefined) return undefined;
	const extension = object(value, "x-fizzyx-admin");
	if (extension.auth === undefined) return {};
	const auth = object(extension.auth, "x-fizzyx-admin.auth");
	const mode = optionalString(auth, "mode");
	if (mode !== "server-cookie" && mode !== "upstream-cookie") {
		throw new Error("x-fizzyx-admin.auth.mode must be server-cookie or upstream-cookie");
	}
	const loginOperationId = optionalString(auth, "loginOperationId");
	if (!loginOperationId) throw new Error("x-fizzyx-admin.auth.loginOperationId is required");
	const routes = auth.routes === undefined ? {} : object(auth.routes, "x-fizzyx-admin.auth.routes");
	const login = optionalString(routes, "login") ?? "/login";
	const afterLogin = optionalString(routes, "afterLogin") ?? "/";
	if (!/^\/[a-zA-Z0-9/_-]*$/.test(login) || !/^\/[a-zA-Z0-9/_-]*$/.test(afterLogin)) {
		throw new Error("x-fizzyx-admin.auth routes must be static absolute application paths");
	}
	return {
		auth: {
			mode,
			loginOperationId,
			logoutOperationId: optionalString(auth, "logoutOperationId"),
			meOperationId: optionalString(auth, "meOperationId"),
			refreshOperationId: optionalString(auth, "refreshOperationId"),
			usernameField: optionalString(auth, "usernameField"),
			passwordField: optionalString(auth, "passwordField"),
			accessTokenPath: optionalString(auth, "accessTokenPath"),
			refreshTokenPath: optionalString(auth, "refreshTokenPath"),
			expiresInPath: optionalString(auth, "expiresInPath"),
			routes: { login, afterLogin },
		},
	};
}

function parseSecurityRequirements(value: unknown): ParsedSecurityRequirement[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new Error("OpenAPI security must be an array");
	return value.map((entry) => Object.keys(object(entry, "OpenAPI security requirement")));
}

function parseSecuritySchemes(doc: Record<string, unknown>): ParsedSecurityScheme[] {
	const components = doc.components as Record<string, unknown> | undefined;
	const schemes = components?.securitySchemes as Record<string, unknown> | undefined;
	if (!schemes) return [];
	return Object.entries(schemes).map(([name, value]) => {
		const scheme = object(value, `security scheme ${name}`);
		const type = scheme.type;
		if (!["apiKey", "http", "oauth2", "openIdConnect", "mutualTLS"].includes(String(type))) {
			throw new Error(`security scheme ${name} has unsupported type ${String(type)}`);
		}
		return {
			name,
			type: type as ParsedSecurityScheme["type"],
			scheme: typeof scheme.scheme === "string" ? scheme.scheme : undefined,
			bearerFormat: typeof scheme.bearerFormat === "string" ? scheme.bearerFormat : undefined,
			in:
				scheme.in === "query" || scheme.in === "header" || scheme.in === "cookie"
					? scheme.in
					: undefined,
			parameterName: typeof scheme.name === "string" ? scheme.name : undefined,
		};
	});
}

function extractRawSchemas(doc: Record<string, unknown>): Record<string, unknown> {
	const components = doc.components as Record<string, unknown> | undefined;
	return (components?.schemas as Record<string, unknown> | undefined) ?? {};
}

function buildSchemaNameResolver(schemas: Record<string, unknown>): SchemaNameResolver {
	const used = new Set<string>();
	const map = new Map<string, string>();

	for (const [rawName] of Object.entries(schemas)) {
		const base = toPascalCase(rawName);
		let normalized = base;
		let counter = 2;
		while (used.has(normalized)) {
			normalized = `${base}${counter}`;
			counter += 1;
		}
		used.add(normalized);
		map.set(rawName, normalized);
	}

	return (rawName) => map.get(rawName) ?? toPascalCase(rawName);
}

function buildSchemaRefMap(
	doc: Record<string, unknown>,
	resolveSchemaName: SchemaNameResolver,
): {
	refMap: Map<string, string>;
	inlineTypes: Map<string, Record<string, unknown>>;
	endpointMeta: Map<
		string,
		{ bodyContentType?: "json" | "multipart"; responseContentType?: "json" | "binary" }
	>;
} {
	const refMap = new Map<string, string>();
	const inlineTypes = new Map<string, Record<string, unknown>>();
	const endpointMeta = new Map<
		string,
		{ bodyContentType?: "json" | "multipart"; responseContentType?: "json" | "binary" }
	>();
	const schemas = extractRawSchemas(doc);

	const paths = doc.paths as Record<string, unknown> | undefined;
	if (!paths) return { refMap, inlineTypes, endpointMeta };

	for (const [path, pathItem] of Object.entries(paths)) {
		const item = pathItem as Record<string, unknown>;
		for (const [method, operation] of Object.entries(item)) {
			if (!["get", "post", "put", "delete", "patch", "head", "options"].includes(method)) continue;
			const op = operation as Record<string, unknown>;
			const opKey = `${method.toUpperCase()} ${path}`;
			const operationId = (op.operationId as string) ?? makeOperationId(method, path);

			// Response
			const responses = op.responses as Record<string, unknown> | undefined;
			if (responses) {
				const success = (responses["200"] ?? responses["201"] ?? responses["default"]) as
					| Record<string, unknown>
					| undefined;
				if (success) {
					const content = success.content as Record<string, unknown> | undefined;
					const json = content?.["application/json"] as Record<string, unknown> | undefined;
					if (json?.schema) {
						const schema = json.schema as Record<string, unknown>;
						if (typeof schema.$ref === "string") {
							const name = schema.$ref.split("/").pop();
							if (name && schemas[name]) {
								refMap.set(`${opKey}/response`, resolveSchemaName(name));
							}
						} else if (schema.type === "array") {
							const items = schema.items as Record<string, unknown> | undefined;
							const ref = items?.$ref;
							if (typeof ref === "string") {
								const name = (ref as string).split("/").pop();
								if (name && schemas[name]) {
									refMap.set(`${opKey}/response`, `${resolveSchemaName(name)}[]`);
								}
							} else {
								const inner = maybeUnwrapEnvelope(schema);
								if (isObjectSchema(inner)) {
									const typeName = `${toPascalCase(operationId)}Response`;
									inlineTypes.set(typeName, inner);
									refMap.set(`${opKey}/response`, typeName);
								} else {
									refMap.set(`${opKey}/response/raw`, schemaToTsType(inner, resolveSchemaName));
								}
							}
						} else {
							const inner = maybeUnwrapEnvelope(schema);
							if (isObjectSchema(inner)) {
								const typeName = `${toPascalCase(operationId)}Response`;
								inlineTypes.set(typeName, inner);
								refMap.set(`${opKey}/response`, typeName);
							} else {
								refMap.set(`${opKey}/response/raw`, schemaToTsType(inner, resolveSchemaName));
							}
						}
					}

					// Detect binary response (e.g. application/octet-stream)
					if (content) {
						const hasJson = !!content["application/json"];
						if (!hasJson) {
							const binaryTypes = Object.keys(content).filter((t) => t !== "application/json");
							if (binaryTypes.length > 0) {
								endpointMeta.set(opKey, { responseContentType: "binary" });
							}
						}
					}
				}
			}

			// Request body
			const requestBody = op.requestBody as Record<string, unknown> | undefined;
			if (requestBody) {
				const content = requestBody.content as Record<string, unknown> | undefined;
				const json = content?.["application/json"] as Record<string, unknown> | undefined;
				const multipart = content?.["multipart/form-data"] as Record<string, unknown> | undefined;

				if (multipart?.schema) {
					// Parse multipart body as its type ref too
					const schema = multipart.schema as Record<string, unknown>;
					if (typeof schema.$ref === "string") {
						const name = schema.$ref.split("/").pop();
						if (name && schemas[name]) {
							refMap.set(`${opKey}/body`, resolveSchemaName(name));
						}
					} else if (isObjectSchema(schema)) {
						const typeName = `${toPascalCase(operationId)}Request`;
						inlineTypes.set(typeName, schema);
						refMap.set(`${opKey}/body`, typeName);
					}
					endpointMeta.set(opKey, { bodyContentType: "multipart" });
				} else if (json?.schema) {
					const schema = json.schema as Record<string, unknown>;
					if (typeof schema.$ref === "string") {
						const name = schema.$ref.split("/").pop();
						if (name && schemas[name]) {
							refMap.set(`${opKey}/body`, resolveSchemaName(name));
						}
					} else if (schema.type === "array") {
						const items = schema.items as Record<string, unknown> | undefined;
						const ref = items?.$ref;
						if (typeof ref === "string") {
							const name = (ref as string).split("/").pop();
							if (name && schemas[name]) {
								refMap.set(`${opKey}/body`, `${resolveSchemaName(name)}[]`);
							}
						} else if (isObjectSchema(schema)) {
							const typeName = `${toPascalCase(operationId)}Request`;
							inlineTypes.set(typeName, schema);
							refMap.set(`${opKey}/body`, typeName);
						} else {
							refMap.set(`${opKey}/body/raw`, schemaToTsType(schema, resolveSchemaName));
						}
					} else if (isObjectSchema(schema)) {
						const typeName = `${toPascalCase(operationId)}Request`;
						inlineTypes.set(typeName, schema);
						refMap.set(`${opKey}/body`, typeName);
					} else {
						refMap.set(`${opKey}/body/raw`, schemaToTsType(schema, resolveSchemaName));
					}
				}
			}
		}
	}

	return { refMap, inlineTypes, endpointMeta };
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
	if (schema.type === "object" && schema.properties) return true;
	if (!schema.type && schema.properties) return true;
	return false;
}

function buildPropertyRefs(
	doc: Record<string, unknown>,
	resolveSchemaName: SchemaNameResolver,
): Map<string, string> {
	const refs = new Map<string, string>();
	const schemas = extractRawSchemas(doc);
	for (const [schemaName, schema] of Object.entries(schemas)) {
		const sourceName = resolveSchemaName(schemaName);
		const props = (schema as Record<string, unknown>)?.properties as
			| Record<string, unknown>
			| undefined;
		if (!props) continue;
		for (const [propName, propSchema] of Object.entries(props)) {
			const ps = propSchema as Record<string, unknown>;
			const ref = ps.$ref;
			if (typeof ref === "string") {
				const targetName = ref.split("/").pop();
				if (targetName && schemas[targetName]) {
					refs.set(`${sourceName}.${propName}`, resolveSchemaName(targetName));
				}
			}
			const itemsRef = (ps.items as Record<string, unknown> | undefined)?.$ref;
			if (typeof itemsRef === "string") {
				const targetName = itemsRef.split("/").pop();
				if (targetName && schemas[targetName]) {
					refs.set(`${sourceName}.${propName}`, `${resolveSchemaName(targetName)}[]`);
				}
			}
		}
	}
	return refs;
}

function parseAllSchemas(
	components: Record<string, unknown> | undefined,
	propRefs: Map<string, string>,
	resolveSchemaName: SchemaNameResolver,
): Record<string, ParsedTypeDef> {
	const rawSchemas = (components?.schemas as Record<string, unknown> | undefined) ?? {};
	const result: Record<string, ParsedTypeDef> = {};
	for (const [name, schema] of Object.entries(rawSchemas)) {
		const resolvedName = resolveSchemaName(name);
		result[resolvedName] = parseSchema(
			resolvedName,
			schema as Record<string, unknown>,
			propRefs,
			resolveSchemaName,
		);
	}
	return result;
}

function parseSchema(
	name: string,
	schema: Record<string, unknown>,
	propRefs: Map<string, string>,
	resolveSchemaName: SchemaNameResolver,
): ParsedTypeDef {
	const description = (schema.description as string) || undefined;

	if (schema.enum) {
		const values = (schema.enum as (string | number)[]).map((v) => JSON.stringify(v));
		return { name, kind: "enum", description, values };
	}

	if (schema.type === "array") {
		const items = schema.items as Record<string, unknown> | undefined;
		if (items?.type === "object" && items.properties) {
			return parseSchema(name, items, propRefs, resolveSchemaName);
		}
		return {
			name,
			kind: "alias",
			description,
			aliasType: schemaToTsType(schema, resolveSchemaName),
		};
	}

	if (schema.type === "object" || schema.properties) {
		const required = (schema.required as string[]) ?? [];
		const properties: ParsedProperty[] = [];
		const rawProps = schema.properties as Record<string, unknown> | undefined;
		if (rawProps) {
			for (const [propName, propSchema] of Object.entries(rawProps)) {
				const ps = propSchema as Record<string, unknown>;
				const context = `${name}.${propName}`;
				const namedRef = propRefs.get(context);
				const tsType = namedRef ?? schemaToTsType(ps, resolveSchemaName);
				properties.push({
					name: propName,
					tsType,
					required: required.includes(propName),
					description: (ps.description as string) || undefined,
					format: typeof ps.format === "string" ? ps.format : undefined,
					minimum: typeof ps.minimum === "number" ? ps.minimum : undefined,
					maximum: typeof ps.maximum === "number" ? ps.maximum : undefined,
					minLength: typeof ps.minLength === "number" ? ps.minLength : undefined,
					maxLength: typeof ps.maxLength === "number" ? ps.maxLength : undefined,
					pattern: typeof ps.pattern === "string" ? ps.pattern : undefined,
					readOnly: ps.readOnly === true ? true : undefined,
					writeOnly: ps.writeOnly === true ? true : undefined,
				});
			}
		}
		return { name, kind: "interface", description, properties };
	}

	return {
		name,
		kind: "alias",
		description,
		aliasType: schemaToTsType(schema, resolveSchemaName),
	};
}

function maybeUnwrapEnvelope(schema: Record<string, unknown>): Record<string, unknown> {
	if (schema.type !== "object") return schema;
	const props = schema.properties as Record<string, unknown> | undefined;
	if (!props) return schema;
	if ("code" in props && "data" in props) {
		return props.data as Record<string, unknown>;
	}
	return schema;
}

function schemaToTsType(
	schema: Record<string, unknown>,
	resolveSchemaName: SchemaNameResolver,
): string {
	if (schema.nullable) {
		const { nullable: _nullable, ...withoutNullable } = schema;
		void _nullable;
		return `${schemaToTsType(withoutNullable, resolveSchemaName)} | null`;
	}
	if (schema.oneOf) {
		return (schema.oneOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName))
			.join(" | ");
	}
	if (schema.anyOf) {
		return (schema.anyOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName))
			.join(" | ");
	}
	if (schema.allOf) {
		return (schema.allOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName))
			.join(" & ");
	}

	if (schema.$ref && typeof schema.$ref === "string") {
		const refName = schema.$ref.split("/").pop() ?? "unknown";
		return refName === "unknown" ? "unknown" : resolveSchemaName(refName);
	}

	const type = schema.type as string | undefined;
	switch (type) {
		case "string":
			return "string";
		case "integer":
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "array": {
			const items = schema.items as Record<string, unknown> | undefined;
			if (!items) return "unknown[]";
			return `${schemaToTsType(items, resolveSchemaName)}[]`;
		}
		case "object": {
			const props = schema.properties as Record<string, unknown> | undefined;
			if (props) {
				const required = (schema.required as string[]) ?? [];
				const fields = Object.entries(props).map(
					([k, v]) =>
						`${k}${required.includes(k) ? "" : "?"}: ${schemaToTsType(v as Record<string, unknown>, resolveSchemaName)}`,
				);
				return `{ ${fields.join("; ")} }`;
			}
			const additional = schema.additionalProperties;
			if (additional !== undefined && additional !== true) {
				return `Record<string, ${schemaToTsType(additional as Record<string, unknown>, resolveSchemaName)}>`;
			}
			return "Record<string, unknown>";
		}
		default:
			return "unknown";
	}
}

function parseAllEndpoints(
	paths: Record<string, unknown> | undefined,
	schemas: Record<string, ParsedTypeDef>,
	refMap: Map<string, string>,
	resolveSchemaName: SchemaNameResolver,
	endpointMeta: Map<
		string,
		{ bodyContentType?: "json" | "multipart"; responseContentType?: "json" | "binary" }
	>,
): ParsedEndpoint[] {
	const endpoints: ParsedEndpoint[] = [];
	if (!paths) return endpoints;

	const methodMap: Record<string, import("../domain/openapi-models").HttpMethod> = {
		get: "get",
		post: "post",
		put: "put",
		delete: "delete",
		patch: "patch",
		head: "head",
		options: "options",
	};

	for (const [path, pathItem] of Object.entries(paths)) {
		const item = pathItem as Record<string, unknown>;
		for (const [method, operation] of Object.entries(item)) {
			const httpMethod = methodMap[method];
			if (!httpMethod) continue;

			const op = operation as Record<string, unknown>;
			const operationId = (op.operationId as string) ?? makeOperationId(httpMethod, path);
			const opKey = `${method.toUpperCase()} ${path}`;
			const description = (op.description as string) || undefined;
			const security = parseSecurityRequirements(op.security);

			const params = (op.parameters ?? []) as Record<string, unknown>[];
			const pathParams: PathParam[] = [];
			const queryParams: QueryParam[] = [];
			for (const param of params) {
				const pName = param.name as string;
				const pIn = param.in as string;
				const pRequired = (param.required as boolean) ?? false;
				const pSchema = param.schema as Record<string, unknown> | undefined;
				const tsType = pSchema ? schemaToTsType(pSchema, resolveSchemaName) : "string";
				const pDesc = (param.description as string) || undefined;
				if (pIn === "path") {
					pathParams.push({ name: pName, typeRef: tsType, description: pDesc });
				} else if (pIn === "query") {
					queryParams.push({
						name: pName,
						typeRef: tsType,
						required: pRequired,
						description: pDesc,
					});
				}
			}

			const bodyTypeRef = refMap.has(`${opKey}/body`)
				? refMap.get(`${opKey}/body`)
				: refMap.get(`${opKey}/body/raw`);

			const responseTypeRef = refMap.has(`${opKey}/response`)
				? refMap.get(`${opKey}/response`)
				: refMap.get(`${opKey}/response/raw`);

			const meta = endpointMeta.get(opKey);

			endpoints.push({
				operationId,
				method: httpMethod,
				path,
				tags: Array.isArray(op.tags)
					? op.tags.filter((tag): tag is string => typeof tag === "string")
					: undefined,
				summary: op.summary as string | undefined,
				description,
				pathParams,
				queryParams,
				bodyTypeRef,
				responseTypeRef,
				bodyContentType: meta?.bodyContentType,
				responseContentType: meta?.responseContentType,
				security,
			});
		}
	}

	return endpoints;
}

function makeOperationId(method: string, path: string): string {
	const cleaned = path
		.replace(/\{(\w+)\}/g, "by-$1")
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return `${method}-${cleaned}`;
}
