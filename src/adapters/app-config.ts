import { existsSync } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { SignalServerConfig } from "../ports/chat-signal";
import { resolveAppConfigPath } from "./app-paths";

export interface PlannerChatConfig {
	readonly signalServer?: SignalServerConfig;
}

export interface FizzyxAppConfig {
	readonly chat?: PlannerChatConfig;
}

type YamlObject = Record<string, unknown>;

export const loadAppConfig = async (path = resolveAppConfigPath()): Promise<FizzyxAppConfig> => {
	if (!existsSync(path)) return {};
	const text = await Bun.file(path).text();
	return parseAppConfig(text, path);
};

export const savePlannerChatSignalServer = async (
	server: SignalServerConfig,
	path = resolveAppConfigPath(),
): Promise<void> => {
	const existing = existsSync(path) ? await Bun.file(path).text() : "";
	const raw = parseYamlObject(existing, path);
	const existingChat = objectValue(raw.chat);
	raw.chat = {
		...existingChat,
		signal_server: formatSignalServer(server),
	};

	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await Bun.write(path, `${Bun.YAML.stringify(raw, null, 2).trimEnd()}\n`);
	await chmod(path, 0o600);
};

export const parseAppConfig = (text: string, path = resolveAppConfigPath()): FizzyxAppConfig => {
	const raw = parseYamlObject(text, path);
	const chat = objectValue(raw.chat);
	const signalServer = parseSignalServer(chat.signal_server ?? chat.signalServer);
	return signalServer ? { chat: { signalServer } } : {};
};

const parseYamlObject = (text: string, path: string): YamlObject => {
	if (text.trim() === "") return {};
	try {
		const parsed = Bun.YAML.parse(text);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("expected YAML object");
		}
		return parsed as YamlObject;
	} catch (cause) {
		throw new Error(`Invalid global config in ${path}: ${String(cause)}`);
	}
};

const parseSignalServer = (raw: unknown): SignalServerConfig | undefined => {
	const obj = objectValue(raw);
	const host = stringValue(obj.host);
	if (!host) return undefined;

	const config: SignalServerConfig = {
		host,
		...(numberValue(obj.port) !== undefined ? { port: numberValue(obj.port) } : {}),
		...(stringValue(obj.path) ? { path: stringValue(obj.path) } : {}),
		...(booleanValue(obj.secure) !== undefined ? { secure: booleanValue(obj.secure) } : {}),
		...(stringValue(obj.key) ? { key: stringValue(obj.key) } : {}),
	};
	return config;
};

const formatSignalServer = (server: SignalServerConfig): YamlObject => ({
	host: server.host,
	...(server.port !== undefined ? { port: server.port } : {}),
	...(server.path !== undefined ? { path: server.path } : {}),
	...(server.secure !== undefined ? { secure: server.secure } : {}),
	...(server.key !== undefined ? { key: server.key } : {}),
});

const objectValue = (value: unknown): YamlObject =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as YamlObject) : {};

const stringValue = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const numberValue = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanValue = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;
