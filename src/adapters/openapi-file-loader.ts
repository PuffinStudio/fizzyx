import { Effect } from "effect";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import type { OpenApiLoader } from "../ports/openapi-loader";
import type {
	ParsedEndpoint,
	ParsedProperty,
	ParsedSpec,
	ParsedTypeDef,
	PathParam,
	QueryParam,
} from "../domain/openapi-models";
import { SpecLoadError, SpecParseError } from "../domain/errors";

export const openapiFileLoader: OpenApiLoader = {
	load: (input: string) =>
		Effect.gen(function* () {
			const ext = input.toLowerCase().split(".").pop();

			let raw: string;
			try {
				raw = yield* Effect.tryPromise({
					try: () => Bun.file(input).text(),
					catch: (cause) =>
						new SpecLoadError({
							message: `cannot read file: ${cause instanceof Error ? cause.message : String(cause)}`,
							source: input,
							cause,
						}),
				});
			} catch (e) {
				return yield* Effect.fail(
					e instanceof SpecLoadError
						? e
						: new SpecLoadError({
								message: `failed to read spec file: ${input}`,
								source: input,
							}),
				);
			}

			let doc: Record<string, unknown>;
			try {
				if (ext === "yaml" || ext === "yml") {
					doc = Bun.YAML.parse(raw) as Record<string, unknown>;
				} else {
					doc = JSON.parse(raw) as Record<string, unknown>;
				}
			} catch (e) {
				return yield* Effect.fail(
					new SpecParseError({
						message: `cannot parse spec file as ${ext === "yaml" || ext === "yml" ? "YAML" : "JSON"}`,
						cause: e,
					}),
				);
			}

			try {
				const parsed = yield* Effect.tryPromise({
					try: () => parseSpec(doc),
					catch: (cause) =>
						new SpecParseError({
							message: `cannot process spec: ${cause instanceof Error ? cause.message : String(cause)}`,
							cause,
						}),
				});
				return parsed;
			} catch (e) {
				return yield* Effect.fail(
					e instanceof SpecParseError
						? e
						: new SpecParseError({
								message: "failed to process spec",
								cause: e,
							}),
				);
			}
		}),
};

export async function parseSpec(doc: Record<string, unknown>): Promise<ParsedSpec> {
	const info = doc.info as Record<string, unknown> | undefined;
	const title = (info?.title as string) ?? "API";
	const version = (info?.version as string) ?? "0.0.0";

	const { refMap, inlineTypes } = buildSchemaRefMap(doc);
	const propRefs = buildPropertyRefs(doc);

	const dereferenced = (await $RefParser.dereference(JSON.parse(JSON.stringify(doc)), {
		parse: { yaml: false },
	})) as unknown as Record<string, unknown>;

	const derefSchemas = parseAllSchemas(
		dereferenced.components as Record<string, unknown> | undefined,
		propRefs,
	);

	// Parse inline response/body schemas as named types so they appear in types.ts
	for (const [typeName, schema] of inlineTypes) {
		if (!derefSchemas[typeName]) {
			derefSchemas[typeName] = parseSchema(typeName, schema, propRefs);
		}
	}

	const paths = dereferenced.paths as Record<string, unknown> | undefined;
	const endpoints = parseAllEndpoints(paths, derefSchemas, refMap);

	return { title, version, endpoints, types: derefSchemas };
}

function extractRawSchemas(doc: Record<string, unknown>): Record<string, unknown> {
	const components = doc.components as Record<string, unknown> | undefined;
	return (components?.schemas as Record<string, unknown> | undefined) ?? {};
}

function buildSchemaRefMap(doc: Record<string, unknown>): {
	refMap: Map<string, string>;
	inlineTypes: Map<string, Record<string, unknown>>;
} {
	const refMap = new Map<string, string>();
	const inlineTypes = new Map<string, Record<string, unknown>>();
	const schemas = extractRawSchemas(doc);

	const paths = doc.paths as Record<string, unknown> | undefined;
	if (!paths) return { refMap, inlineTypes };

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
								refMap.set(`${opKey}/response`, name);
							}
						} else if (schema.type === "array") {
							const items = schema.items as Record<string, unknown> | undefined;
							const ref = items?.$ref;
							if (typeof ref === "string") {
								const name = (ref as string).split("/").pop();
								if (name && schemas[name]) {
									refMap.set(`${opKey}/response`, `${name}[]`);
								}
							} else {
								const inner = maybeUnwrapEnvelope(schema);
								if (isObjectSchema(inner)) {
									const typeName = `${toPascalCase(operationId)}Response`;
									inlineTypes.set(typeName, inner);
									refMap.set(`${opKey}/response`, typeName);
								} else {
									refMap.set(`${opKey}/response/raw`, schemaToTsType(inner));
								}
							}
						} else {
							const inner = maybeUnwrapEnvelope(schema);
							if (isObjectSchema(inner)) {
								const typeName = `${toPascalCase(operationId)}Response`;
								inlineTypes.set(typeName, inner);
								refMap.set(`${opKey}/response`, typeName);
							} else {
								refMap.set(`${opKey}/response/raw`, schemaToTsType(inner));
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
				if (json?.schema) {
					const schema = json.schema as Record<string, unknown>;
					if (typeof schema.$ref === "string") {
						const name = schema.$ref.split("/").pop();
						if (name && schemas[name]) {
							refMap.set(`${opKey}/body`, name);
						}
					} else if (schema.type === "array") {
						const items = schema.items as Record<string, unknown> | undefined;
						const ref = items?.$ref;
						if (typeof ref === "string") {
							const name = (ref as string).split("/").pop();
							if (name && schemas[name]) {
								refMap.set(`${opKey}/body`, `${name}[]`);
							}
						} else if (isObjectSchema(schema)) {
							const typeName = `${toPascalCase(operationId)}Request`;
							inlineTypes.set(typeName, schema);
							refMap.set(`${opKey}/body`, typeName);
						} else {
							refMap.set(`${opKey}/body/raw`, schemaToTsType(schema));
						}
					} else if (isObjectSchema(schema)) {
						const typeName = `${toPascalCase(operationId)}Request`;
						inlineTypes.set(typeName, schema);
						refMap.set(`${opKey}/body`, typeName);
					} else {
						refMap.set(`${opKey}/body/raw`, schemaToTsType(schema));
					}
				}
			}
		}
	}

	return { refMap, inlineTypes };
}

function isObjectSchema(schema: Record<string, unknown>): boolean {
	if (schema.type === "object" && schema.properties) return true;
	if (!schema.type && schema.properties) return true;
	return false;
}

function toPascalCase(s: string): string {
	return s
		.replace(/[-_.]/g, " ")
		.split(" ")
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

function buildPropertyRefs(doc: Record<string, unknown>): Map<string, string> {
	const refs = new Map<string, string>();
	const schemas = extractRawSchemas(doc);
	for (const [schemaName, schema] of Object.entries(schemas)) {
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
					refs.set(`${schemaName}.${propName}`, targetName);
				}
			}
			const itemsRef = (ps.items as Record<string, unknown> | undefined)?.$ref;
			if (typeof itemsRef === "string") {
				const targetName = itemsRef.split("/").pop();
				if (targetName && schemas[targetName]) {
					refs.set(`${schemaName}.${propName}`, `${targetName}[]`);
				}
			}
		}
	}
	return refs;
}

function parseAllSchemas(
	components: Record<string, unknown> | undefined,
	propRefs: Map<string, string>,
): Record<string, ParsedTypeDef> {
	const rawSchemas = (components?.schemas as Record<string, unknown> | undefined) ?? {};
	const result: Record<string, ParsedTypeDef> = {};
	for (const [name, schema] of Object.entries(rawSchemas)) {
		result[name] = parseSchema(name, schema as Record<string, unknown>, propRefs);
	}
	return result;
}

function parseSchema(
	name: string,
	schema: Record<string, unknown>,
	propRefs: Map<string, string>,
): ParsedTypeDef {
	const description = (schema.description as string) || undefined;

	if (schema.enum) {
		const values = (schema.enum as (string | number)[]).map((v) => JSON.stringify(v));
		return { name, kind: "enum", description, values };
	}

	if (schema.type === "array") {
		const items = schema.items as Record<string, unknown> | undefined;
		if (items?.type === "object" && items.properties) {
			return parseSchema(name, items, propRefs);
		}
		return { name, kind: "alias", description, aliasType: schemaToTsType(schema) };
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
				const tsType = namedRef ?? schemaToTsType(ps);
				properties.push({
					name: propName,
					tsType,
					required: required.includes(propName),
					description: (ps.description as string) || undefined,
				});
			}
		}
		return { name, kind: "interface", description, properties };
	}

	return { name, kind: "alias", description, aliasType: schemaToTsType(schema) };
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

function schemaToTsType(schema: Record<string, unknown>): string {
	if (schema.nullable) {
		const withoutNullable = { ...schema };
		delete withoutNullable.nullable;
		return `${schemaToTsType(withoutNullable)} | null`;
	}
	if (schema.oneOf) {
		return (schema.oneOf as Record<string, unknown>[]).map((s) => schemaToTsType(s)).join(" | ");
	}
	if (schema.anyOf) {
		return (schema.anyOf as Record<string, unknown>[]).map((s) => schemaToTsType(s)).join(" | ");
	}
	if (schema.allOf) {
		return (schema.allOf as Record<string, unknown>[]).map((s) => schemaToTsType(s)).join(" & ");
	}

	if (schema.$ref && typeof schema.$ref === "string") {
		return schema.$ref.split("/").pop() ?? "unknown";
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
			return `${schemaToTsType(items)}[]`;
		}
		case "object": {
			const props = schema.properties as Record<string, unknown> | undefined;
			if (props) {
				const required = (schema.required as string[]) ?? [];
				const fields = Object.entries(props).map(
					([k, v]) =>
						`${k}${required.includes(k) ? "" : "?"}: ${schemaToTsType(v as Record<string, unknown>)}`,
				);
				return `{ ${fields.join("; ")} }`;
			}
			const additional = schema.additionalProperties;
			if (additional !== undefined && additional !== true) {
				return `Record<string, ${schemaToTsType(additional as Record<string, unknown>)}>`;
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

			const params = (op.parameters ?? []) as Record<string, unknown>[];
			const pathParams: PathParam[] = [];
			const queryParams: QueryParam[] = [];
			for (const param of params) {
				const pName = param.name as string;
				const pIn = param.in as string;
				const pRequired = (param.required as boolean) ?? false;
				const pSchema = param.schema as Record<string, unknown> | undefined;
				const tsType = pSchema ? schemaToTsType(pSchema) : "string";
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

			endpoints.push({
				operationId,
				method: httpMethod,
				path,
				summary: op.summary as string | undefined,
				description,
				pathParams,
				queryParams,
				bodyTypeRef,
				responseTypeRef,
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
