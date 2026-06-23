// Auto-update — fire-and-forget silent install in a child process.
// Never blocks the parent, never prints to the user.
import { VERSION } from "./version";

const CURRENT_VERSION = VERSION;

let checked = false;

export function checkForUpdate(): void {
	if (checked) return;
	checked = true;

	if (process.env.CI || !process.stderr.isTTY) return;
	if (CURRENT_VERSION === "0.0.0") return;

	const script = `
const CURRENT = ${JSON.stringify(CURRENT_VERSION)};
async function check() {
  try {
    const res = await fetch("https://registry.npmjs.org/@puffinstudio/fizzyx/latest", { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return;
    const { version } = await res.json();
    if (!version || version === CURRENT) return;
    const cur = CURRENT.split(".").map(Number);
    const lat = version.split(".").map(Number);
    for (let i = 0; i < Math.max(cur.length, lat.length); i++) {
      const a = lat[i] ?? 0;
      const b = cur[i] ?? 0;
      if (a > b) {
        const proc = Bun.spawnSync(["bun", "add", "-g", "@puffinstudio/fizzyx"], { stdio: ["ignore", "ignore", "ignore"] });
        if (proc.exitCode === 0) return;
        return;
      }
      if (a < b) return;
    }
  } catch {}
}
check();
`;
	Bun.spawn(["bun", "-e", script], { stdio: ["ignore", "ignore", "inherit"] }).unref();
}
