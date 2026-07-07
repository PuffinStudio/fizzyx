import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	loadAppConfig,
	parseAppConfig,
	savePlannerChatSignalServer,
} from "../src/adapters/app-config";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-app-config-"));

test("parseAppConfig reads planner chat signal server config", () => {
	const config = parseAppConfig(`chat:
  signal_server:
    host: peer.example.com
    port: 9000
    path: /peerjs
    secure: false
    key: app
`);

	expect(config.chat?.signalServer).toEqual({
		host: "peer.example.com",
		port: 9000,
		path: "/peerjs",
		secure: false,
		key: "app",
	});
});

test("savePlannerChatSignalServer writes global app config and preserves other keys", async () => {
	const root = makeTempDir();
	const configPath = join(root, "config.yaml");

	try {
		await Bun.write(configPath, "updates:\n  check: false\n");
		await savePlannerChatSignalServer(
			{
				host: "localhost",
				port: 9000,
				path: "/peerjs",
				secure: false,
			},
			configPath,
		);

		const config = await loadAppConfig(configPath);
		const text = await Bun.file(configPath).text();
		expect(config.chat?.signalServer).toEqual({
			host: "localhost",
			port: 9000,
			path: "/peerjs",
			secure: false,
		});
		expect(text).toContain("updates:");
		expect(statSync(configPath).mode & 0o777).toBe(0o600);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
