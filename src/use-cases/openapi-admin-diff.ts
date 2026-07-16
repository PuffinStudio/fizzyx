type StructuralRecord = Readonly<Record<string, unknown>>;

export interface AdminAppPlanLike {
	readonly resources?: readonly AdminResourceLike[];
	readonly navigation?: unknown;
	readonly defaults?: unknown;
	readonly presentation?: unknown;
}

export interface AdminResourceLike extends StructuralRecord {
	readonly key?: string;
	readonly id?: string;
	readonly operations?: Readonly<Record<string, unknown>>;
	readonly columns?: readonly unknown[];
	readonly fields?: readonly unknown[];
	readonly forms?: {
		readonly create?: readonly unknown[];
		readonly update?: readonly unknown[];
	};
	readonly presentation?: unknown;
}

export interface AdminResourceReference {
	key?: string;
	id?: string;
}

export interface AdminValueChange {
	before: unknown;
	after: unknown;
}

export interface AdminOperationDescriptor {
	kind: string;
	operationId?: string;
	path?: string;
}

export interface AdminOperationChange {
	kind: string;
	before: AdminOperationDescriptor;
	after: AdminOperationDescriptor;
}

export interface AdminFieldDescriptorChange {
	scope: "columns" | "fields" | "forms.create" | "forms.update";
	name: string;
	before: unknown;
	after: unknown;
}

export interface AdminFieldChanges {
	added: Array<{ scope: AdminFieldDescriptorChange["scope"]; name: string; descriptor: unknown }>;
	removed: Array<{ scope: AdminFieldDescriptorChange["scope"]; name: string; descriptor: unknown }>;
	changed: AdminFieldDescriptorChange[];
}

export interface AdminResourceChange {
	resource: AdminResourceReference;
	identityChanges: Partial<Record<"key" | "id", AdminValueChange>>;
	propertyChanges: Record<string, AdminValueChange>;
	operations: {
		added: AdminOperationDescriptor[];
		removed: AdminOperationDescriptor[];
		changed: AdminOperationChange[];
	};
	fields: AdminFieldChanges;
	presentation?: AdminValueChange;
}

export interface OpenApiAdminPlanDiff {
	resources: {
		added: AdminResourceReference[];
		removed: AdminResourceReference[];
		changed: AdminResourceChange[];
	};
	navigation?: AdminValueChange;
	presentation?: AdminValueChange;
}

const compareText = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

const canonical = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, child]) => child !== undefined)
				.sort(([left], [right]) => compareText(left, right))
				.map(([key, child]) => [key, canonical(child)]),
		);
	}
	return value;
};

const equal = (left: unknown, right: unknown): boolean =>
	JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const reference = (resource: AdminResourceLike): AdminResourceReference => ({
	...(resource.key === undefined ? {} : { key: resource.key }),
	...(resource.id === undefined ? {} : { id: resource.id }),
});

const resourceSortKey = (resource: AdminResourceLike | AdminResourceReference): string =>
	`${resource.key ?? ""}\u0000${resource.id ?? ""}`;

const operationDescriptor = (kind: string, value: unknown): AdminOperationDescriptor => {
	const operation = value && typeof value === "object" ? (value as StructuralRecord) : {};
	const endpoint =
		operation.endpoint && typeof operation.endpoint === "object"
			? (operation.endpoint as StructuralRecord)
			: {};
	const operationId = operation.operationId;
	const path = operation.path ?? endpoint.path;
	return {
		kind,
		...(typeof operationId === "string" ? { operationId } : {}),
		...(typeof path === "string" ? { path } : {}),
	};
};

const diffOperations = (before: AdminResourceLike, after: AdminResourceLike) => {
	const previous = before.operations ?? {};
	const next = after.operations ?? {};
	const kinds = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort(compareText);
	const added: AdminOperationDescriptor[] = [];
	const removed: AdminOperationDescriptor[] = [];
	const changed: AdminOperationChange[] = [];
	for (const kind of kinds) {
		const oldOperation = previous[kind];
		const newOperation = next[kind];
		if (oldOperation === undefined && newOperation !== undefined) {
			added.push(operationDescriptor(kind, newOperation));
		} else if (oldOperation !== undefined && newOperation === undefined) {
			removed.push(operationDescriptor(kind, oldOperation));
		} else if (oldOperation !== undefined && newOperation !== undefined) {
			const oldDescriptor = operationDescriptor(kind, oldOperation);
			const newDescriptor = operationDescriptor(kind, newOperation);
			if (!equal(oldDescriptor, newDescriptor)) {
				changed.push({ kind, before: oldDescriptor, after: newDescriptor });
			}
		}
	}
	return { added, removed, changed };
};

type FieldScope = AdminFieldDescriptorChange["scope"];

const fieldSets = (resource: AdminResourceLike): Array<[FieldScope, readonly unknown[]]> => [
	["columns", resource.columns ?? []],
	["fields", resource.fields ?? []],
	["forms.create", resource.forms?.create ?? []],
	["forms.update", resource.forms?.update ?? []],
];

const fieldName = (field: unknown, index: number): string => {
	if (field && typeof field === "object") {
		const record = field as StructuralRecord;
		for (const candidate of [record.name, record.key, record.id]) {
			if (typeof candidate === "string" && candidate.length > 0) return candidate;
		}
	}
	return `#${index}`;
};

const indexedFields = (fields: readonly unknown[]): Map<string, unknown> =>
	new Map(fields.map((field, index) => [fieldName(field, index), field]));

const diffFields = (before: AdminResourceLike, after: AdminResourceLike): AdminFieldChanges => {
	const added: AdminFieldChanges["added"] = [];
	const removed: AdminFieldChanges["removed"] = [];
	const changed: AdminFieldChanges["changed"] = [];
	const previousSets = new Map(fieldSets(before));
	for (const [scope, nextFields] of fieldSets(after)) {
		const previous = indexedFields(previousSets.get(scope) ?? []);
		const next = indexedFields(nextFields);
		const names = [...new Set([...previous.keys(), ...next.keys()])].sort(compareText);
		for (const name of names) {
			const oldField = previous.get(name);
			const newField = next.get(name);
			if (oldField === undefined && newField !== undefined) {
				added.push({ scope, name, descriptor: canonical(newField) });
			} else if (oldField !== undefined && newField === undefined) {
				removed.push({ scope, name, descriptor: canonical(oldField) });
			} else if (!equal(oldField, newField)) {
				changed.push({ scope, name, before: canonical(oldField), after: canonical(newField) });
			}
		}
	}
	return { added, removed, changed };
};

const ignoredResourceProperties = new Set([
	"key",
	"id",
	"operations",
	"columns",
	"fields",
	"forms",
	"presentation",
]);

const diffProperties = (
	before: AdminResourceLike,
	after: AdminResourceLike,
): Record<string, AdminValueChange> => {
	const changes: Record<string, AdminValueChange> = {};
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(compareText);
	for (const key of keys) {
		if (ignoredResourceProperties.has(key) || equal(before[key], after[key])) continue;
		changes[key] = { before: canonical(before[key]), after: canonical(after[key]) };
	}
	return changes;
};

const matchResources = (
	before: readonly AdminResourceLike[],
	after: readonly AdminResourceLike[],
): {
	pairs: Array<[AdminResourceLike, AdminResourceLike]>;
	removed: AdminResourceLike[];
	added: AdminResourceLike[];
} => {
	const oldResources = [...before].sort((a, b) =>
		compareText(resourceSortKey(a), resourceSortKey(b)),
	);
	const newResources = [...after].sort((a, b) =>
		compareText(resourceSortKey(a), resourceSortKey(b)),
	);
	const used = new Set<number>();
	const pairs: Array<[AdminResourceLike, AdminResourceLike]> = [];
	const unmatchedOld: AdminResourceLike[] = [];

	for (const oldResource of oldResources) {
		const byKey = oldResource.key
			? newResources.findIndex(
					(candidate, index) => !used.has(index) && candidate.key === oldResource.key,
				)
			: -1;
		const byId =
			byKey < 0 && oldResource.id
				? newResources.findIndex(
						(candidate, index) => !used.has(index) && candidate.id === oldResource.id,
					)
				: -1;
		const index = byKey >= 0 ? byKey : byId;
		if (index < 0) unmatchedOld.push(oldResource);
		else {
			used.add(index);
			pairs.push([oldResource, newResources[index]!]);
		}
	}

	return {
		pairs,
		removed: unmatchedOld,
		added: newResources.filter((_, index) => !used.has(index)),
	};
};

/** Returns a stable, JSON-serializable description of meaningful admin-plan drift. */
export const diffAdminAppPlans = (
	before: AdminAppPlanLike | null | undefined,
	after: AdminAppPlanLike | null | undefined,
): OpenApiAdminPlanDiff => {
	const matched = matchResources(before?.resources ?? [], after?.resources ?? []);
	const changed: AdminResourceChange[] = [];
	for (const [oldResource, newResource] of matched.pairs) {
		const operations = diffOperations(oldResource, newResource);
		const fields = diffFields(oldResource, newResource);
		const propertyChanges = diffProperties(oldResource, newResource);
		const identityChanges: AdminResourceChange["identityChanges"] = {};
		if (oldResource.key !== newResource.key) {
			identityChanges.key = { before: oldResource.key, after: newResource.key };
		}
		if (oldResource.id !== newResource.id) {
			identityChanges.id = { before: oldResource.id, after: newResource.id };
		}
		const presentation = equal(oldResource.presentation, newResource.presentation)
			? undefined
			: {
					before: canonical(oldResource.presentation),
					after: canonical(newResource.presentation),
				};
		if (
			Object.keys(identityChanges).length > 0 ||
			Object.keys(propertyChanges).length > 0 ||
			operations.added.length > 0 ||
			operations.removed.length > 0 ||
			operations.changed.length > 0 ||
			fields.added.length > 0 ||
			fields.removed.length > 0 ||
			fields.changed.length > 0 ||
			presentation
		) {
			changed.push({
				resource: reference(newResource),
				identityChanges,
				propertyChanges,
				operations,
				fields,
				...(presentation ? { presentation } : {}),
			});
		}
	}
	changed.sort((a, b) => compareText(resourceSortKey(a.resource), resourceSortKey(b.resource)));

	const oldPresentation = before?.defaults ?? before?.presentation;
	const newPresentation = after?.defaults ?? after?.presentation;
	return {
		resources: {
			added: matched.added
				.map(reference)
				.sort((a, b) => compareText(resourceSortKey(a), resourceSortKey(b))),
			removed: matched.removed
				.map(reference)
				.sort((a, b) => compareText(resourceSortKey(a), resourceSortKey(b))),
			changed,
		},
		...(equal(before?.navigation, after?.navigation)
			? {}
			: {
					navigation: {
						before: canonical(before?.navigation),
						after: canonical(after?.navigation),
					},
				}),
		...(equal(oldPresentation, newPresentation)
			? {}
			: {
					presentation: { before: canonical(oldPresentation), after: canonical(newPresentation) },
				}),
	};
};

export const diffOpenApiAdminPlans = diffAdminAppPlans;
