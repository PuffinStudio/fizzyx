import $RefParser from "@apidevtools/json-schema-ref-parser";
import { toPascalCase } from "../domain/codegen-utils";
import type {
	ParsedEndpoint,
	ParsedAdminConfig,
	ParsedAdminActionDescriptor,
	ParsedAdminMetadataDiagnostic,
	ParsedAdminTagMetadata,
	ParsedOpenApiTag,
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
	const { tags, diagnostics: adminMetadataDiagnostics } = parseTopLevelTags(doc.tags);

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

	return {
		title,
		version,
		endpoints,
		types: derefSchemas,
		securitySchemes,
		security,
		admin,
		tags,
		adminMetadataDiagnostics,
	};
}

const adminSurfaces = new Set(["page", "dialog", "sheet"]);

function parseTopLevelTags(value: unknown): {
	tags: ParsedOpenApiTag[];
	diagnostics: ParsedAdminMetadataDiagnostic[];
} {
	const diagnostics: ParsedAdminMetadataDiagnostic[] = [];
	if (value === undefined) return { tags: [], diagnostics };
	if (!Array.isArray(value)) {
		return {
			tags: [],
			diagnostics: [{ code: "invalid-admin-metadata", message: "OpenAPI tags must be an array" }],
		};
	}
	const tags: ParsedOpenApiTag[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
			diagnostics.push({
				code: "invalid-admin-metadata",
				message: "OpenAPI tag must be an object",
			});
			continue;
		}
		const source = entry as Record<string, unknown>;
		if (typeof source.name !== "string" || !source.name.trim()) {
			diagnostics.push({
				code: "invalid-admin-metadata",
				message: "OpenAPI tag name must be a non-empty string",
			});
			continue;
		}
		const name = source.name.trim();
		const parsed: ParsedOpenApiTag = {
			name,
			...(typeof source.description === "string" ? { description: source.description } : {}),
		};
		const metadata = parseTagAdminMetadata(source["x-fizzyx-admin"], name, diagnostics);
		if (metadata) parsed.admin = metadata;
		tags.push(parsed);
	}
	return { tags, diagnostics };
}

function parseTagAdminMetadata(
	value: unknown,
	tag: string,
	diagnostics: ParsedAdminMetadataDiagnostic[],
): ParsedAdminTagMetadata | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		diagnostics.push({
			code: "invalid-admin-metadata",
			message: `x-fizzyx-admin for tag ${tag} must be an object`,
			tag,
		});
		return undefined;
	}
	const source = value as Record<string, unknown>;
	const result: ParsedAdminTagMetadata = {};
	const invalid = (field: string, expected: string) =>
		diagnostics.push({
			code: "invalid-admin-metadata",
			message: `x-fizzyx-admin.${field} for tag ${tag} must be ${expected}`,
			tag,
		});
	for (const field of ["label", "group"] as const) {
		const candidate = source[field];
		if (candidate === undefined) continue;
		if (typeof candidate === "string" && candidate.trim()) result[field] = candidate.trim();
		else invalid(field, "a non-empty string");
	}
	if (source.key !== undefined) {
		if (typeof source.key === "string" && /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(source.key)) {
			result.key = source.key;
		} else invalid("key", "a stable lowercase key");
	}
	if (source.order !== undefined) {
		if (typeof source.order === "number" && Number.isFinite(source.order))
			result.order = source.order;
		else invalid("order", "a finite number");
	}
	if (source.icon !== undefined) {
		if (typeof source.icon === "string" && source.icon.trim()) result.icon = source.icon.trim();
		else invalid("icon", "a non-empty controlled icon key");
	}
	if (source.hidden !== undefined) {
		if (typeof source.hidden === "boolean") result.hidden = source.hidden;
		else invalid("hidden", "a boolean");
	}
	if (source.presentation !== undefined) {
		if (
			!source.presentation ||
			typeof source.presentation !== "object" ||
			Array.isArray(source.presentation)
		) {
			invalid("presentation", "an object");
		} else {
			const presentation: ParsedAdminTagMetadata["presentation"] = {};
			for (const field of ["create", "edit", "detail"] as const) {
				const candidate = (source.presentation as Record<string, unknown>)[field];
				if (candidate === undefined) continue;
				if (typeof candidate === "string" && adminSurfaces.has(candidate))
					presentation[field] = candidate as "page" | "dialog" | "sheet";
				else invalid(`presentation.${field}`, "page, dialog, or sheet");
			}
			result.presentation = presentation;
		}
	}
	if (source.data !== undefined) {
		if (!source.data || typeof source.data !== "object" || Array.isArray(source.data))
			invalid("data", "an object");
		else {
			const data: NonNullable<ParsedAdminTagMetadata["data"]> = {};
			for (const field of ["rowsPath", "totalPath", "detailPath"] as const) {
				const candidate = (source.data as Record<string, unknown>)[field];
				if (candidate === undefined) continue;
				if (typeof candidate === "string" && candidate.trim()) data[field] = candidate.trim();
				else invalid(`data.${field}`, "a non-empty property path");
			}
			result.data = data;
		}
	}
	if (source.permissions !== undefined) {
		if (
			!source.permissions ||
			typeof source.permissions !== "object" ||
			Array.isArray(source.permissions)
		)
			invalid("permissions", "an object");
		else {
			const permissions: Record<string, string> = {};
			for (const [key, candidate] of Object.entries(
				source.permissions as Record<string, unknown>,
			)) {
				if (typeof candidate === "string" && candidate.trim()) permissions[key] = candidate.trim();
				else invalid(`permissions.${key}`, "a non-empty string");
			}
			result.permissions = permissions;
		}
	}
	if (source.actions !== undefined) {
		if (!Array.isArray(source.actions)) invalid("actions", "an array");
		else {
			const actions: ParsedAdminActionDescriptor[] = [];
			const actionKeys = new Set<string>();
			for (const [index, candidate] of source.actions.entries()) {
				if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
					invalid(`actions.${index}`, "an object");
					continue;
				}
				const action = candidate as Record<string, unknown>;
				if (typeof action.key !== "string" || !action.key.trim()) {
					invalid(`actions.${index}.key`, "a non-empty string");
					continue;
				}
				const key = action.key.trim();
				if (actionKeys.has(key)) {
					diagnostics.push({
						code: "ambiguous-admin-metadata",
						message: `x-fizzyx-admin.actions for tag ${tag} declares key ${key} more than once`,
						tag,
					});
					continue;
				}
				actionKeys.add(key);
				const parsed: ParsedAdminActionDescriptor = { key };
				for (const field of ["label", "operationId", "permission"] as const) {
					if (typeof action[field] === "string" && action[field].trim())
						parsed[field] = action[field].trim();
				}
				if (action.scope === "resource" || action.scope === "row" || action.scope === "bulk")
					parsed.scope = action.scope;
				else if (action.scope !== undefined)
					invalid(`actions.${index}.scope`, "resource, row, or bulk");
				if (typeof action.presentation === "string" && adminSurfaces.has(action.presentation))
					parsed.presentation = action.presentation as "page" | "dialog" | "sheet";
				else if (action.presentation !== undefined)
					invalid(`actions.${index}.presentation`, "page, dialog, or sheet");
				actions.push(parsed);
			}
			result.actions = actions;
		}
	}
	return result;
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

const primitiveEnumValues = (value: unknown): Array<string | number | boolean> | undefined => {
	if (!Array.isArray(value)) return undefined;
	const values = value.filter(
		(item): item is string | number | boolean =>
			typeof item === "string" || typeof item === "number" || typeof item === "boolean",
	);
	return values.length ? values : undefined;
};

const propertyKind = (schema: Record<string, unknown>): ParsedProperty["kind"] => {
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (types.includes("integer")) return "integer";
	if (
		types.includes("string") ||
		types.includes("number") ||
		types.includes("boolean") ||
		types.includes("array") ||
		types.includes("object")
	) {
		return types.find((type) => type !== "null") as ParsedProperty["kind"];
	}
	if (schema.properties) return "object";
	return undefined;
};

const parseProperty = (
	name: string,
	schema: Record<string, unknown>,
	required: boolean,
	tsType: string,
	resolveSchemaName: SchemaNameResolver,
	seen: Set<Record<string, unknown>> = new Set(),
	expand = true,
): ParsedProperty => {
	const property: ParsedProperty = {
		name,
		tsType,
		required,
		kind: propertyKind(schema),
		description: (schema.description as string) || undefined,
		format: typeof schema.format === "string" ? schema.format : undefined,
		enumValues: primitiveEnumValues(schema.enum),
		nullable:
			schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes("null"))
				? true
				: undefined,
		minimum: typeof schema.minimum === "number" ? schema.minimum : undefined,
		maximum: typeof schema.maximum === "number" ? schema.maximum : undefined,
		minItems: typeof schema.minItems === "number" ? schema.minItems : undefined,
		maxItems: typeof schema.maxItems === "number" ? schema.maxItems : undefined,
		minLength: typeof schema.minLength === "number" ? schema.minLength : undefined,
		maxLength: typeof schema.maxLength === "number" ? schema.maxLength : undefined,
		pattern: typeof schema.pattern === "string" ? schema.pattern : undefined,
		readOnly: schema.readOnly === true ? true : undefined,
		writeOnly: schema.writeOnly === true ? true : undefined,
	};
	if (!expand || seen.has(schema)) return property;
	const nextSeen = new Set(seen).add(schema);
	if (property.kind === "array" && schema.items && typeof schema.items === "object") {
		const items = schema.items as Record<string, unknown>;
		const normalizedType = tsType.replace(/\s*\|\s*null/g, "");
		const namedItemType = normalizedType.endsWith("[]") ? normalizedType.slice(0, -2) : undefined;
		property.items = parseProperty(
			"item",
			items,
			true,
			namedItemType ?? schemaToTsType(items, resolveSchemaName),
			resolveSchemaName,
			nextSeen,
			!namedItemType,
		);
	}
	if (property.kind === "object" && schema.properties) {
		const requiredNames = new Set(Array.isArray(schema.required) ? schema.required : []);
		property.properties = Object.entries(schema.properties as Record<string, unknown>).map(
			([childName, childSchema]) =>
				parseProperty(
					childName,
					childSchema as Record<string, unknown>,
					requiredNames.has(childName),
					schemaToTsType(childSchema as Record<string, unknown>, resolveSchemaName),
					resolveSchemaName,
					nextSeen,
				),
		);
	}
	return property;
};

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
				properties.push(
					parseProperty(propName, ps, required.includes(propName), tsType, resolveSchemaName),
				);
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
	seen: Set<Record<string, unknown>> = new Set(),
): string {
	if (seen.has(schema)) return "unknown";
	const nextSeen = new Set(seen).add(schema);
	const typeUnion = Array.isArray(schema.type) ? schema.type : undefined;
	if (schema.nullable || typeUnion?.includes("null")) {
		const { nullable: _nullable, ...withoutNullable } = schema;
		void _nullable;
		if (typeUnion) withoutNullable.type = typeUnion.filter((type) => type !== "null");
		if (Array.isArray(withoutNullable.type) && withoutNullable.type.length === 1) {
			withoutNullable.type = withoutNullable.type[0];
		}
		return `${schemaToTsType(withoutNullable, resolveSchemaName, nextSeen)} | null`;
	}
	if (schema.oneOf) {
		return (schema.oneOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName, nextSeen))
			.join(" | ");
	}
	if (schema.anyOf) {
		return (schema.anyOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName, nextSeen))
			.join(" | ");
	}
	if (schema.allOf) {
		return (schema.allOf as Record<string, unknown>[])
			.map((s) => schemaToTsType(s, resolveSchemaName, nextSeen))
			.join(" & ");
	}

	if (schema.$ref && typeof schema.$ref === "string") {
		const refName = schema.$ref.split("/").pop() ?? "unknown";
		return refName === "unknown" ? "unknown" : resolveSchemaName(refName);
	}

	const type = Array.isArray(schema.type)
		? schema.type.find((candidate): candidate is string => typeof candidate === "string")
		: (schema.type as string | undefined);
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
			return `${schemaToTsType(items, resolveSchemaName, nextSeen)}[]`;
		}
		case "object": {
			const props = schema.properties as Record<string, unknown> | undefined;
			if (props) {
				const required = (schema.required as string[]) ?? [];
				const fields = Object.entries(props).map(
					([k, v]) =>
						`${k}${required.includes(k) ? "" : "?"}: ${schemaToTsType(v as Record<string, unknown>, resolveSchemaName, nextSeen)}`,
				);
				return `{ ${fields.join("; ")} }`;
			}
			const additional = schema.additionalProperties;
			if (additional !== undefined && additional !== true) {
				return `Record<string, ${schemaToTsType(additional as Record<string, unknown>, resolveSchemaName, nextSeen)}>`;
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
		const pathLevelParams = Array.isArray(item.parameters)
			? (item.parameters as Record<string, unknown>[])
			: [];
		const siblingPathParams = new Map<string, Record<string, unknown>>();
		for (const candidate of Object.values(item)) {
			if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
			const candidateParams = (candidate as Record<string, unknown>).parameters;
			if (!Array.isArray(candidateParams)) continue;
			for (const param of candidateParams as Record<string, unknown>[]) {
				if (param.in === "path" && typeof param.name === "string") {
					siblingPathParams.set(param.name, param);
				}
			}
		}
		for (const [method, operation] of Object.entries(item)) {
			const httpMethod = methodMap[method];
			if (!httpMethod) continue;

			const op = operation as Record<string, unknown>;
			const operationId = (op.operationId as string) ?? makeOperationId(httpMethod, path);
			const opKey = `${method.toUpperCase()} ${path}`;
			const description = (op.description as string) || undefined;
			const security = parseSecurityRequirements(op.security);

			const operationParams = Array.isArray(op.parameters)
				? (op.parameters as Record<string, unknown>[])
				: [];
			const paramsByLocationAndName = new Map<string, Record<string, unknown>>();
			for (const param of [...pathLevelParams, ...operationParams]) {
				paramsByLocationAndName.set(`${String(param.in)}:${String(param.name)}`, param);
			}
			for (const name of [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!)) {
				const key = `path:${name}`;
				if (paramsByLocationAndName.has(key)) continue;
				paramsByLocationAndName.set(
					key,
					siblingPathParams.get(name) ?? {
						name,
						in: "path",
						required: true,
						schema: { type: "string" },
					},
				);
			}
			const params = [...paramsByLocationAndName.values()];
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
						format: typeof pSchema?.format === "string" ? pSchema.format : undefined,
						enumValues: primitiveEnumValues(pSchema?.enum),
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
