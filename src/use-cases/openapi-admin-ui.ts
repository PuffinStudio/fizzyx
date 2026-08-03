import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ADMIN_ICON_KEYS,
	type AdminIconKey,
	type AdminUiOverlay,
	type AdminUiResourceOverlay,
} from "../domain/openapi-admin-models";
import type { AdminPresentationDefaults, AdminSurface } from "../domain/openapi-models";
import adminUiOverlayTemplate from "../templates/openapi-admin/admin-ui.yaml.txt" with { type: "text" };

export const ADMIN_UI_OVERLAY_PATH = ".fizzyx/admin-ui.yaml";
const MAX_OVERLAY_BYTES = 1024 * 1024;
const BLOCKED_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ICON_KEYS = new Set<string>(ADMIN_ICON_KEYS);
const SURFACES = new Set<AdminSurface>(["page", "dialog", "sheet"]);

export const DEFAULT_ADMIN_UI_OVERLAY = adminUiOverlayTemplate;
export const DEFAULT_ADMIN_UI_OVERLAY_FINGERPRINT = new Bun.CryptoHasher("sha256")
	.update(DEFAULT_ADMIN_UI_OVERLAY)
	.digest("hex");

export interface AdminUiOverlayReadResult {
	overlay?: AdminUiOverlay;
	fingerprint?: string;
}

const invalid = (message: string): never => {
	throw new Error(`invalid admin UI overlay: ${message}`);
};

const object = (value: unknown, path: string): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return invalid(`${path} must be an object`);
	}
	return value as Record<string, unknown>;
};

const allowedKeys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
	const expected = new Set(allowed);
	for (const key of Object.keys(value)) {
		if (!expected.has(key)) invalid(`${path}.${key} is not supported`);
	}
};

const optionalString = (value: unknown, path: string): string | undefined => {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.trim().length === 0 || value.length > 160) {
		return invalid(`${path} must be a non-empty string of at most 160 characters`);
	}
	return value;
};

const optionalBoolean = (value: unknown, path: string): boolean | undefined => {
	if (value === undefined) return undefined;
	if (typeof value !== "boolean") return invalid(`${path} must be a boolean`);
	return value;
};

const optionalOrder = (value: unknown, path: string): number | undefined => {
	if (value === undefined) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value)) {
		return invalid(`${path} must be a safe integer`);
	}
	return value;
};

const optionalSurface = (value: unknown, path: string): AdminSurface | undefined => {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !SURFACES.has(value as AdminSurface)) {
		return invalid(`${path} must be page, dialog, or sheet`);
	}
	return value as AdminSurface;
};

const optionalPresentation = (
	value: unknown,
	path: string,
): Partial<AdminPresentationDefaults> | undefined => {
	if (value === undefined) return undefined;
	const source = object(value, path);
	allowedKeys(source, ["create", "edit", "detail"], path);
	const presentation = {
		create: optionalSurface(source.create, `${path}.create`),
		edit: optionalSurface(source.edit, `${path}.edit`),
		detail: optionalSurface(source.detail, `${path}.detail`),
	};
	return Object.fromEntries(
		Object.entries(presentation).filter(([, item]) => item !== undefined),
	) as Partial<AdminPresentationDefaults>;
};

const optionalNames = (value: unknown, path: string): string[] | undefined => {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || value.length > 100) {
		return invalid(`${path} must be an array with at most 100 field names`);
	}
	const names = value.map((item, index) => optionalString(item, `${path}[${index}]`)!);
	if (new Set(names).size !== names.length) return invalid(`${path} must not contain duplicates`);
	return names;
};

const resourceOverlay = (value: unknown, path: string): AdminUiResourceOverlay => {
	const source = object(value, path);
	allowedKeys(
		source,
		["label", "group", "order", "icon", "hidden", "presentation", "columns", "fields"],
		path,
	);
	const icon = optionalString(source.icon, `${path}.icon`);
	if (icon && !ICON_KEYS.has(icon)) invalid(`${path}.icon is not a controlled icon key`);
	return Object.fromEntries(
		Object.entries({
			label: optionalString(source.label, `${path}.label`),
			group: optionalString(source.group, `${path}.group`),
			order: optionalOrder(source.order, `${path}.order`),
			icon: icon as AdminIconKey | undefined,
			hidden: optionalBoolean(source.hidden, `${path}.hidden`),
			presentation: optionalPresentation(source.presentation, `${path}.presentation`),
			columns: optionalNames(source.columns, `${path}.columns`),
			fields: optionalNames(source.fields, `${path}.fields`),
		}).filter(([, item]) => item !== undefined),
	) as AdminUiResourceOverlay;
};

export const parseAdminUiOverlay = (text: string): AdminUiOverlay => {
	if (Buffer.byteLength(text, "utf8") > MAX_OVERLAY_BYTES) invalid("file is larger than 1 MiB");
	let parsed: unknown;
	try {
		parsed = Bun.YAML.parse(text);
	} catch (cause) {
		return invalid(`cannot parse YAML: ${cause instanceof Error ? cause.message : String(cause)}`);
	}
	const source = object(parsed, "root");
	allowedKeys(source, ["version", "title", "resources"], "root");
	if (source.version !== 1) invalid("root.version must be 1");
	const resourcesSource = object(source.resources, "root.resources");
	const resources: Record<string, AdminUiResourceOverlay> = {};
	for (const [key, value] of Object.entries(resourcesSource)) {
		if (
			BLOCKED_OBJECT_KEYS.has(key) ||
			key.trim().length === 0 ||
			key.length > 200 ||
			[...key].some((character) => character.charCodeAt(0) < 32)
		) {
			invalid(`root.resources contains an unsafe resource key: ${JSON.stringify(key)}`);
		}
		resources[key] = resourceOverlay(value, `root.resources.${key}`);
	}
	return {
		version: 1,
		...(source.title === undefined ? {} : { title: optionalString(source.title, "root.title") }),
		resources,
	};
};

export const readAdminUiOverlay = (root: string): AdminUiOverlayReadResult => {
	const path = join(root, ADMIN_UI_OVERLAY_PATH);
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8");
	return {
		overlay: parseAdminUiOverlay(text),
		fingerprint: new Bun.CryptoHasher("sha256").update(text).digest("hex"),
	};
};
