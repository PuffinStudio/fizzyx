import camelcase from "camelcase";
import type { ParsedEndpoint } from "./openapi-models";

export const renderPropertyKey = (name: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);

export function toFnName(ep: ParsedEndpoint): string {
  return camelcase(ep.operationId);
}

export function toPascalCase(s: string): string {
  return camelcase(s, { pascalCase: true });
}
