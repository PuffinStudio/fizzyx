import type {
	AdminAppPlan,
	AdminListQueryMapping,
	AdminOperationKind,
	AdminPlanDiagnostic,
	AdminResourcePlan,
} from "../domain/openapi-admin-models";
import type { ParsedEndpoint, ParsedSpec, ParsedTypeDef } from "../domain/openapi-models";
import { discoverAdminAuth } from "./openapi-admin-auth";

const pathSegments = (path: string): string[] => path.split("/").filter(Boolean);
const isPathParam = (segment: string): boolean => segment.startsWith("{") && segment.endsWith("}");

const slugify = (value: string): string =>
	value
		.trim()
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const resourceIdFor = (endpoint: ParsedEndpoint): string | undefined =>
	(endpoint.tags?.[0] ? slugify(endpoint.tags[0]) : undefined) ??
	pathSegments(endpoint.path).find((segment) => !isPathParam(segment));

const humanize = (value: string): string =>
	value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const classifyOperation = (endpoint: ParsedEndpoint): AdminOperationKind | undefined => {
	const member = pathSegments(endpoint.path).some(isPathParam);
	if (endpoint.method === "get") return member ? "detail" : "list";
	if (endpoint.method === "post" && !member) return "create";
	if ((endpoint.method === "put" || endpoint.method === "patch") && member) return "update";
	if (endpoint.method === "delete" && member) return "delete";
	return undefined;
};

const typeDef = (spec: ParsedSpec, reference?: string): ParsedTypeDef | undefined => {
	if (!reference) return undefined;
	return spec.types[reference.replace(/\[\]$/, "")];
};

const normalizedParam = (value: string): string => value.toLowerCase().replace(/[-_]/g, "");
const findParam = (endpoint: ParsedEndpoint, candidates: string[]): string | undefined =>
	endpoint.queryParams.find((param) => candidates.includes(normalizedParam(param.name)))?.name;

const listQueryMapping = (
	endpoint: ParsedEndpoint,
	columns: AdminResourcePlan["columns"],
): AdminListQueryMapping | undefined => {
	const mapping: AdminListQueryMapping = {
		page: findParam(endpoint, ["page", "pagenumber"]),
		offset: findParam(endpoint, ["offset", "skip"]),
		limit: findParam(endpoint, ["limit", "pagesize", "perpage"]),
		search: findParam(endpoint, ["search", "q", "query", "keyword"]),
		sort: findParam(endpoint, ["sort", "sortby", "orderby"]),
		order: findParam(endpoint, ["order", "direction", "sortorder"]),
		filters: endpoint.queryParams
			.filter((param) =>
				columns.some((column) => normalizedParam(column.name) === normalizedParam(param.name)),
			)
			.map((param) => param.name),
	};
	return Object.values(mapping).some((value) => (Array.isArray(value) ? value.length > 0 : !!value))
		? mapping
		: undefined;
};

export const planAdminApp = (spec: ParsedSpec): AdminAppPlan => {
	const resources = new Map<string, AdminResourcePlan>();
	const authDiscovery = discoverAdminAuth(spec);
	const diagnostics: AdminPlanDiagnostic[] = [...authDiscovery.diagnostics];
	const configuredAuthOperations = Object.entries(authDiscovery.auth.config ?? {})
		.filter(([key, value]) => key.endsWith("OperationId") && typeof value === "string")
		.map(([, value]) => value as string);
	const strongAuthCandidates = Object.values(authDiscovery.auth.candidates)
		.flat()
		.filter((candidate) => candidate.score >= 6)
		.map((candidate) => candidate.operationId);
	const reservedAuthOperations = new Set([...configuredAuthOperations, ...strongAuthCandidates]);

	for (const endpoint of spec.endpoints) {
		if (reservedAuthOperations.has(endpoint.operationId)) continue;
		const resourceId = resourceIdFor(endpoint);
		const kind = classifyOperation(endpoint);
		if (!resourceId || !kind) {
			diagnostics.push({
				code: "unsupported-operation",
				message: `Cannot map ${endpoint.method.toUpperCase()} ${endpoint.path} to an admin CRUD page`,
				operationId: endpoint.operationId,
			});
			continue;
		}

		const current = resources.get(resourceId) ?? {
			id: resourceId,
			label: humanize(resourceId),
			path: `/${resourceId}`,
			idParam: endpoint.pathParams[0]?.name,
			columns: [],
			fields: [],
			operations: {},
		};
		if (current.operations[kind]) {
			diagnostics.push({
				code: "ambiguous-operation",
				message: `Multiple ${kind} operations map to resource ${resourceId}`,
				operationId: endpoint.operationId,
			});
			continue;
		}

		current.operations[kind] = { operationId: endpoint.operationId, endpoint };
		current.idParam ??= endpoint.pathParams[0]?.name;
		if (kind === "list" || kind === "detail") {
			current.columns = typeDef(spec, endpoint.responseTypeRef)?.properties ?? current.columns;
			if (kind === "list") current.listQuery = listQueryMapping(endpoint, current.columns);
		}
		if (kind === "create" || kind === "update") {
			current.fields =
				typeDef(spec, endpoint.bodyTypeRef)?.properties?.filter((property) => !property.readOnly) ??
				current.fields;
		}
		resources.set(resourceId, current);
	}

	return {
		title: spec.title,
		resources: [...resources.values()],
		diagnostics,
		auth: authDiscovery.auth,
	};
};
