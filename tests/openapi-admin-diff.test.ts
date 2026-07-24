import { expect, test } from "bun:test";
import { diffAdminAppPlans } from "../src/use-cases/openapi-admin-diff";

test("diffs resources by key with id fallback and sorts the result", () => {
	const before = {
		resources: [
			{ key: "zebra", id: "z", operations: {} },
			{ key: "users-old", id: "users", operations: {} },
		],
	};
	const after = {
		resources: [
			{ key: "teams", id: "teams", operations: {} },
			{ key: "users", id: "users", operations: {} },
		],
	};

	const diff = diffAdminAppPlans(before, after);

	expect(diff.resources.added).toEqual([{ key: "teams", id: "teams" }]);
	expect(diff.resources.removed).toEqual([{ key: "zebra", id: "z" }]);
	expect(diff.resources.changed[0]?.identityChanges.key).toEqual({
		before: "users-old",
		after: "users",
	});
});

test("reports operation additions, removals, and path or operationId changes", () => {
	const diff = diffAdminAppPlans(
		{
			resources: [
				{
					key: "users",
					operations: {
						list: { operationId: "oldList", endpoint: { path: "/old-users" } },
						delete: { operationId: "deleteUser", endpoint: { path: "/users/{id}" } },
					},
				},
			],
		},
		{
			resources: [
				{
					key: "users",
					operations: {
						list: { operationId: "listUsers", endpoint: { path: "/users" } },
						create: { operationId: "createUser", path: "/users" },
					},
				},
			],
		},
	);

	expect(diff.resources.changed[0]?.operations).toEqual({
		added: [{ kind: "create", operationId: "createUser", path: "/users" }],
		removed: [{ kind: "delete", operationId: "deleteUser", path: "/users/{id}" }],
		changed: [
			{
				kind: "list",
				before: { kind: "list", operationId: "oldList", path: "/old-users" },
				after: { kind: "list", operationId: "listUsers", path: "/users" },
			},
		],
	});
});

test("diffs field descriptors, navigation, and presentation without interface coupling", () => {
	const before = {
		resources: [
			{
				key: "users",
				fields: [
					{ name: "name", required: false, type: "string" },
					{ name: "legacy", type: "string" },
				],
				forms: { create: [{ name: "email", type: "string" }] },
				presentation: { density: "compact" },
			},
		],
		navigation: { groups: [{ id: "main", items: ["users"] }] },
		defaults: { density: "compact" },
	};
	const after = {
		resources: [
			{
				key: "users",
				fields: [
					{ type: "string", required: true, name: "name" },
					{ name: "createdAt", type: "date" },
				],
				forms: { create: [{ name: "email", type: "email" }] },
				presentation: { density: "comfortable" },
			},
		],
		navigation: { groups: [{ id: "main", items: ["users", "settings"] }] },
		defaults: { density: "comfortable" },
	};

	const diff = diffAdminAppPlans(before, after);
	const resource = diff.resources.changed[0]!;

	expect(resource.fields.added.map(({ scope, name }) => [scope, name])).toEqual([
		["fields", "createdAt"],
	]);
	expect(resource.fields.removed.map(({ scope, name }) => [scope, name])).toEqual([
		["fields", "legacy"],
	]);
	expect(resource.fields.changed.map(({ scope, name }) => [scope, name])).toEqual([
		["fields", "name"],
		["forms.create", "email"],
	]);
	expect(resource.presentation).toEqual({
		before: { density: "compact" },
		after: { density: "comfortable" },
	});
	expect(diff.navigation).toBeDefined();
	expect(diff.presentation).toBeDefined();
});

test("is deterministic across resource order and object property order", () => {
	const first = diffAdminAppPlans(
		{ resources: [] },
		{
			resources: [
				{ id: "b", key: "b", operations: {} },
				{ key: "a", id: "a", operations: {} },
			],
		},
	);
	const second = diffAdminAppPlans(
		{ resources: [] },
		{
			resources: [
				{ operations: {}, id: "a", key: "a" },
				{ operations: {}, key: "b", id: "b" },
			],
		},
	);

	expect(first).toEqual(second);
	expect(first.resources.added).toEqual([
		{ key: "a", id: "a" },
		{ key: "b", id: "b" },
	]);
});
