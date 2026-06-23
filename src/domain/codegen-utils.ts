import camelcase from "camelcase";
import type { ParsedEndpoint } from "./openapi-models";

export function toFnName(ep: ParsedEndpoint): string {
	return camelcase(ep.operationId);
}

export function toPascalCase(s: string): string {
	return camelcase(s, { pascalCase: true });
}
