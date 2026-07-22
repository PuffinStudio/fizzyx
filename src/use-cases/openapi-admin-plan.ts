import type {
	AdminAppPlan,
	AdminFilterField,
	AdminIconKey,
	AdminListQueryMapping,
	AdminOperationKind,
	AdminPlanDiagnostic,
	AdminResourcePlan,
} from "../domain/openapi-admin-models";
import type {
	AdminPresentationDefaults,
	OpenApiAdminProjectConfig,
	ParsedAdminTagMetadata,
	ParsedEndpoint,
	ParsedProperty,
	ParsedSpec,
	ParsedTypeDef,
} from "../domain/openapi-models";
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

const operationResourceId = (operationId: string): string | undefined => {
	const segments = operationId.split(".").filter(Boolean);
	if (segments.length < 3) return undefined;
	return slugify(segments.at(-2) ?? "") || undefined;
};

const resourceIdFor = (endpoint: ParsedEndpoint): string | undefined =>
	operationResourceId(endpoint.operationId) ??
	(endpoint.tags?.[0] ? slugify(endpoint.tags[0]) : undefined) ??
	pathSegments(endpoint.path)
		.filter((segment) => !isPathParam(segment))
		.at(-1);

const humanize = (value: string): string =>
	value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const classifyOperation = (endpoint: ParsedEndpoint): AdminOperationKind | undefined => {
	const segments = pathSegments(endpoint.path);
	const member = isPathParam(segments.at(-1) ?? "");
	const hasPathParam = segments.some(isPathParam);
	const action = endpoint.operationId.split(".").at(-1)?.toLowerCase() ?? "";
	if (endpoint.method === "get") return member ? "detail" : hasPathParam ? undefined : "list";
	if (endpoint.method === "post") {
		return !hasPathParam ? "create" : undefined;
	}
	if (endpoint.method === "put" || endpoint.method === "patch") {
		return member || /(update|edit|replace)$/.test(action) ? "update" : undefined;
	}
	if (endpoint.method === "delete") return "delete";
	return undefined;
};

const typeDef = (spec: ParsedSpec, reference?: string): ParsedTypeDef | undefined => {
	if (!reference) return undefined;
	return spec.types[reference.replace(/\[\]$/, "")];
};

const propertyTypeDef = (spec: ParsedSpec, property?: ParsedProperty): ParsedTypeDef | undefined =>
	property ? typeDef(spec, property.tsType.replace(/\s*\|\s*null/g, "")) : undefined;

const propertyChildren = (spec: ParsedSpec, property: ParsedProperty): ParsedProperty[] =>
	propertyTypeDef(spec, property)?.properties ?? property.properties ?? [];

interface InferredResponseData {
	columns: ParsedProperty[];
	rowsPath?: string;
	totalPath?: string;
	detailPath?: string;
}

const findListRows = (
	spec: ParsedSpec,
	properties: ParsedProperty[],
	prefix = "",
	depth = 0,
): InferredResponseData | undefined => {
	if (depth > 3) return undefined;
	const arrays = properties.filter(
		(property) =>
			property.kind === "array" || property.tsType.replace(/\s*\|\s*null/g, "").endsWith("[]"),
	);
	const preferred = ["items", "rows", "results", "records", "data"];
	arrays.sort(
		(a, b) =>
			(preferred.indexOf(a.name) === -1 ? preferred.length : preferred.indexOf(a.name)) -
			(preferred.indexOf(b.name) === -1 ? preferred.length : preferred.indexOf(b.name)),
	);
	for (const property of arrays) {
		const item = property.items;
		const columns = item
			? (item.properties ?? propertyTypeDef(spec, item)?.properties ?? [])
			: (typeDef(spec, property.tsType.replace(/\[\](?:\s*\|\s*null)?$/, ""))?.properties ?? []);
		if (!columns.length) continue;
		const rowsPath = prefix ? `${prefix}.${property.name}` : property.name;
		const total = properties.find((candidate) =>
			["total", "totalCount", "count"].includes(candidate.name),
		);
		return {
			columns,
			rowsPath,
			...(total ? { totalPath: prefix ? `${prefix}.${total.name}` : total.name } : {}),
		};
	}
	for (const property of properties) {
		const children = propertyChildren(spec, property);
		if (!children.length) continue;
		const path = prefix ? `${prefix}.${property.name}` : property.name;
		const nested = findListRows(spec, children, path, depth + 1);
		if (nested) return nested;
	}
	return undefined;
};

const inferListData = (spec: ParsedSpec, endpoint: ParsedEndpoint): InferredResponseData => {
	const response = typeDef(spec, endpoint.responseTypeRef);
	const direct = typeDef(spec, endpoint.responseTypeRef?.replace(/\[\]$/, ""));
	if (endpoint.responseTypeRef?.endsWith("[]")) return { columns: direct?.properties ?? [] };
	const properties = response?.properties ?? [];
	return findListRows(spec, properties) ?? { columns: properties };
};

const inferDetailData = (spec: ParsedSpec, endpoint: ParsedEndpoint): InferredResponseData => {
	const properties = typeDef(spec, endpoint.responseTypeRef)?.properties ?? [];
	const data = properties.find((property) => property.name === "data");
	const dataColumns = data ? propertyChildren(spec, data) : [];
	return dataColumns.length
		? { columns: dataColumns, detailPath: "data" }
		: { columns: properties };
};

const selectListColumns = (properties: ParsedProperty[], limit = 8): ParsedProperty[] => {
	const candidates = properties.filter(
		(property) => property.kind !== "array" && property.kind !== "object",
	);
	const score = (property: ParsedProperty): number => {
		const name = normalizedParam(property.name);
		if (["title", "name", "label"].includes(name)) return 100;
		if (["id", "uuid", "key"].includes(name)) return 95;
		if (["status", "state"].includes(name)) return 90;
		if (["type", "category", "kind"].includes(name)) return 85;
		if (/createdat|updatedat|startat|endat|date|time/.test(name)) return 75;
		if (/city|location|email|phone|amount|price|fee|count|capacity/.test(name)) return 70;
		return 50;
	};
	return candidates
		.map((property, index) => ({ property, index, score: score(property) }))
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, limit)
		.sort((a, b) => a.index - b.index)
		.map(({ property }) => property);
};

const normalizedParam = (value: string): string => value.toLowerCase().replace(/[-_]/g, "");
const findParam = (endpoint: ParsedEndpoint, candidates: string[]): string | undefined =>
	endpoint.queryParams.find((param) => candidates.includes(normalizedParam(param.name)))?.name;

const listQueryMapping = (
	endpoint: ParsedEndpoint,
	columns: AdminResourcePlan["columns"],
): AdminListQueryMapping | undefined => {
	const filterParams = endpoint.queryParams.filter((param) =>
		columns.some((column) => normalizedParam(column.name) === normalizedParam(param.name)),
	);
	const filterField = (param: (typeof filterParams)[number]): AdminFilterField => ({
		name: param.name,
		type: param.enumValues?.length
			? "select"
			: param.typeRef.includes("boolean")
				? "boolean"
				: param.format === "date" || param.format === "date-time"
					? "date"
					: param.typeRef.includes("number")
						? "number"
						: "text",
		...(param.enumValues?.length ? { options: param.enumValues } : {}),
	});
	const mapping: AdminListQueryMapping = {
		page: findParam(endpoint, ["page", "pagenumber"]),
		offset: findParam(endpoint, ["offset", "skip"]),
		limit: findParam(endpoint, ["limit", "pagesize", "perpage"]),
		search: findParam(endpoint, ["search", "q", "query", "keyword"]),
		sort: findParam(endpoint, ["sort", "sortby", "orderby"]),
		order: findParam(endpoint, ["order", "direction", "sortorder"]),
		filters: filterParams.map((param) => param.name),
		filterFields: filterParams.map(filterField),
	};
	return Object.values(mapping).some((value) => (Array.isArray(value) ? value.length > 0 : !!value))
		? mapping
		: undefined;
};

const BUILTIN_PRESENTATION: AdminPresentationDefaults = {
	create: "page",
	edit: "page",
	detail: "page",
};

const ADMIN_ICON_KEYS = new Set<AdminIconKey>([
	"database",
	"file",
	"folder",
	"home",
	"package",
	"settings",
	"shield",
	"shopping-cart",
	"user",
	"users",
]);

export interface AdminPlannerOptions {
	presentation?: Partial<AdminPresentationDefaults>;
	/** Backward-compatible alias that applies to both create and edit. */
	createMode?: OpenApiAdminProjectConfig["createMode"];
}

const projectDefaults = (options: AdminPlannerOptions): AdminPresentationDefaults => ({
	...BUILTIN_PRESENTATION,
	...(options.createMode ? { create: options.createMode, edit: options.createMode } : {}),
	...options.presentation,
});

const navigationFor = (resources: AdminResourcePlan[]) => {
	const groups = new Map<
		string,
		{
			id: string;
			label: string;
			order: number;
			items: AdminAppPlan["navigation"]["groups"][number]["items"];
		}
	>();
	for (const resource of resources) {
		if (resource.hidden || !resource.operations.list) continue;
		const label = resource.group ?? "Resources";
		const id = slugify(label) || "resources";
		const order = resource.order ?? Number.MAX_SAFE_INTEGER;
		const group = groups.get(id) ?? { id, label, order, items: [] };
		group.order = Math.min(group.order, order);
		group.items.push({
			resourceKey: resource.key,
			label: resource.label,
			path: resource.path,
			order,
			...(resource.icon ? { icon: resource.icon } : {}),
		});
		groups.set(id, group);
	}
	return {
		groups: [...groups.values()]
			.map((group) => ({
				...group,
				items: group.items.sort(
					(a, b) =>
						a.order - b.order ||
						a.label.localeCompare(b.label) ||
						a.resourceKey.localeCompare(b.resourceKey),
				),
			}))
			.sort(
				(a, b) => a.order - b.order || a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
			),
	};
};

export const planAdminApp = (spec: ParsedSpec, options: AdminPlannerOptions = {}): AdminAppPlan => {
	const resources = new Map<string, AdminResourcePlan>();
	const authDiscovery = discoverAdminAuth(spec);
	const diagnostics: AdminPlanDiagnostic[] = [
		...authDiscovery.diagnostics,
		...(spec.adminMetadataDiagnostics ?? []),
	];
	const defaults = projectDefaults(options);
	const tagMetadata = new Map<string, ParsedAdminTagMetadata | undefined>();
	for (const tag of spec.tags ?? []) {
		if (tagMetadata.has(tag.name)) {
			diagnostics.push({
				code: "ambiguous-admin-metadata",
				message: `Top-level tag ${tag.name} is declared more than once; the first declaration is used`,
				tag: tag.name,
			});
			continue;
		}
		tagMetadata.set(tag.name, tag.admin);
	}
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
		const tag = endpoint.tags?.[0];
		const tagId = tag ? slugify(tag) : undefined;
		const metadata = tagId === resourceId && tag ? tagMetadata.get(tag) : undefined;
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
			key: metadata?.key ?? resourceId,
			id: resourceId,
			label: metadata?.label ?? humanize(resourceId),
			path: `/${resourceId}`,
			group: metadata?.group ?? (tagId !== resourceId && tag ? humanize(tag) : undefined),
			order: metadata?.order,
			hidden: metadata?.hidden,
			presentation: { ...defaults, ...metadata?.presentation },
			permissions: metadata?.permissions,
			actions: metadata?.actions,
			idParam: endpoint.pathParams[0]?.name,
			columns: [],
			fields: [],
			operations: {},
		};
		if (metadata?.icon) {
			if (ADMIN_ICON_KEYS.has(metadata.icon as AdminIconKey))
				current.icon = metadata.icon as AdminIconKey;
			else if (!current.icon) {
				diagnostics.push({
					code: "invalid-admin-metadata",
					message: `Unknown admin icon key ${metadata.icon} for tag ${tag}`,
					tag,
					resourceKey: current.key,
				});
			}
		}
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
		if (kind === "list") {
			const inferred = inferListData(spec, endpoint);
			current.columns = inferred.columns.length
				? selectListColumns(inferred.columns)
				: current.columns;
			current.listQuery = listQueryMapping(endpoint, inferred.columns);
			const data = metadata?.data ?? {
				...(inferred.rowsPath ? { rowsPath: inferred.rowsPath } : {}),
				...(inferred.totalPath ? { totalPath: inferred.totalPath } : {}),
			};
			current.data = { ...current.data, ...data };
			if (current.listQuery || Object.keys(data).length) {
				current.list = { query: current.listQuery, data };
			}
		}
		if (kind === "detail") {
			const inferred = inferDetailData(spec, endpoint);
			if (!current.columns.length && inferred.columns.length) current.columns = inferred.columns;
			const detailPath = metadata?.data?.detailPath ?? inferred.detailPath;
			if (detailPath) current.data = { ...current.data, detailPath };
		}
		if (kind === "create" || kind === "update") {
			const fields =
				typeDef(spec, endpoint.bodyTypeRef)?.properties?.filter((property) => !property.readOnly) ??
				current.fields;
			current.fields = fields;
			current.forms = { ...current.forms, [kind]: fields };
		}
		resources.set(resourceId, current);
	}
	const plannedResources = [...resources.values()];
	const keys = new Map<string, AdminResourcePlan>();
	for (const resource of plannedResources) {
		const existing = keys.get(resource.key);
		if (!existing) {
			keys.set(resource.key, resource);
			continue;
		}
		diagnostics.push({
			code: "ambiguous-admin-metadata",
			message: `Resources ${existing.id} and ${resource.id} use the same stable key ${resource.key}`,
			resourceKey: resource.key,
		});
		resource.key = resource.id;
	}

	return {
		version: 2,
		title: spec.title,
		resources: plannedResources,
		navigation: navigationFor(plannedResources),
		defaults,
		diagnostics,
		auth: authDiscovery.auth,
	};
};
