import { VERSION } from "./version";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { resolveLastUpdateCheckPath } from "../adapters/app-paths";

const CURRENT_VERSION = VERSION;
const COOLDOWN_MS = 4 * 60 * 60 * 1000;

let checked = false;

function readLastCheck(): number | null {
	try {
		const path = resolveLastUpdateCheckPath();
		if (!existsSync(path)) return null;
		return Number(readFileSync(path, "utf8").trim()) || null;
	} catch {
		return null;
	}
}

function writeLastCheck(): void {
	try {
		const path = resolveLastUpdateCheckPath();
		const dir = dirname(path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		writeFileSync(path, String(Date.now()), { mode: 0o600 });
	} catch {
		// best effort
	}
}

async function checkNpmUpdate(): Promise<boolean> {
	try {
		const res = await fetch("https://registry.npmjs.org/@puffinstudio/fizzyx/latest", {
			signal: AbortSignal.timeout(1000),
		});
		if (!res.ok) return false;
		const { version } = (await res.json()) as { version?: string };
		if (!version) return false;

		if (version !== CURRENT_VERSION) {
			const cur = CURRENT_VERSION.split(".").map(Number);
			const lat = version.split(".").map(Number);
			for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
				const a = lat[i] ?? 0;
				const b = cur[i] ?? 0;
				if (a > b) {
					Bun.spawnSync(["bun", "add", "-g", "@puffinstudio/fizzyx"], {
						stdio: ["ignore", "ignore", "ignore"],
					});
					break;
				}
				if (a < b) break;
			}
		}

		return true;
	} catch {
		return false;
	}
}

export function checkForUpdate(): void {
	if (checked) return;
	checked = true;

	if (process.env.CI || !process.stderr.isTTY) return;
	if (CURRENT_VERSION === "0.0.0") return;

	const lastCheck = readLastCheck();
	if (lastCheck && Date.now() - lastCheck < COOLDOWN_MS) return;

	checkNpmUpdate()
		.then((completed) => {
			if (completed) writeLastCheck();
		})
		.catch(() => {});
}
