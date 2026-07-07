export const FIZZYX_PACKAGE_NAME = "@puffinstudio/fizzyx";
export const FIZZYX_LATEST_URL = `https://registry.npmjs.org/${FIZZYX_PACKAGE_NAME}/latest`;

export type UpdateInstaller = (
	target: string,
) => Promise<UpdateInstallResult> | UpdateInstallResult;

export interface UpdateInstallResult {
	readonly exitCode: number;
}

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type UpdatePlan =
	| {
			readonly status: "already-current";
			readonly currentVersion: string;
			readonly latestVersion: string;
	  }
	| {
			readonly status: "local-newer";
			readonly currentVersion: string;
			readonly latestVersion: string;
	  }
	| {
			readonly status: "update-available";
			readonly currentVersion: string;
			readonly latestVersion: string;
			readonly target: string;
	  };

export type UpdateResult =
	| {
			readonly status: "already-current";
			readonly currentVersion: string;
			readonly latestVersion: string;
	  }
	| {
			readonly status: "local-newer";
			readonly currentVersion: string;
			readonly latestVersion: string;
	  }
	| {
			readonly status: "updated";
			readonly previousVersion: string;
			readonly latestVersion: string;
			readonly target: string;
	  }
	| {
			readonly status: "install-failed";
			readonly currentVersion: string;
			readonly latestVersion: string;
			readonly target: string;
			readonly exitCode: number;
	  };

export interface RunFizzyxUpdateOptions {
	readonly currentVersion: string;
	readonly fetchImpl?: FetchImpl;
	readonly install?: UpdateInstaller;
	readonly timeoutMs?: number;
	readonly latestUrl?: string;
	readonly packageName?: string;
}

export const checkFizzyxUpdate = async ({
	currentVersion,
	fetchImpl = fetch,
	timeoutMs = 5000,
	latestUrl = FIZZYX_LATEST_URL,
	packageName = FIZZYX_PACKAGE_NAME,
}: Omit<RunFizzyxUpdateOptions, "install">): Promise<UpdatePlan> => {
	const latestVersion = await fetchLatestPackageVersion({
		fetchImpl,
		timeoutMs,
		url: latestUrl,
	});
	const comparison = compareVersions(currentVersion, latestVersion);
	if (comparison === null) {
		throw new Error(`Cannot compare versions: current=${currentVersion}, latest=${latestVersion}`);
	}

	if (comparison === 0) {
		return { status: "already-current", currentVersion, latestVersion };
	}

	if (comparison > 0) {
		return { status: "local-newer", currentVersion, latestVersion };
	}

	const target = `${packageName}@${latestVersion}`;
	return { status: "update-available", currentVersion, latestVersion, target };
};

export const installFizzyxTarget = async (
	target: string,
	install: UpdateInstaller = installWithBun,
): Promise<UpdateInstallResult> => install(target);

export const runFizzyxUpdate = async ({
	install = installWithBun,
	...options
}: RunFizzyxUpdateOptions): Promise<UpdateResult> => {
	const plan = await checkFizzyxUpdate(options);
	if (plan.status !== "update-available") return plan;

	const target = plan.target;
	const result = await install(target);
	if (result.exitCode !== 0) {
		return {
			status: "install-failed",
			currentVersion: plan.currentVersion,
			latestVersion: plan.latestVersion,
			target,
			exitCode: result.exitCode,
		};
	}

	return {
		status: "updated",
		previousVersion: plan.currentVersion,
		latestVersion: plan.latestVersion,
		target,
	};
};

export const fetchLatestPackageVersion = async ({
	fetchImpl = fetch,
	timeoutMs = 5000,
	url = FIZZYX_LATEST_URL,
}: {
	readonly fetchImpl?: FetchImpl;
	readonly timeoutMs?: number;
	readonly url?: string;
} = {}): Promise<string> => {
	const response = await fetchImpl(url, {
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`Failed to check for updates: HTTP ${response.status}`);
	}

	const data = (await response.json()) as { version?: unknown };
	if (typeof data.version !== "string" || data.version.trim().length === 0) {
		throw new Error("Failed to check for updates: registry response has no version");
	}
	return data.version.trim();
};

export const compareVersions = (left: string, right: string): -1 | 0 | 1 | null => {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (!a || !b) return null;

	for (let i = 0; i < 3; i += 1) {
		const diff = a.main[i]! - b.main[i]!;
		if (diff < 0) return -1;
		if (diff > 0) return 1;
	}

	if (a.prerelease === b.prerelease) return 0;
	if (a.prerelease === undefined) return 1;
	if (b.prerelease === undefined) return -1;
	return comparePrerelease(a.prerelease, b.prerelease);
};

const installWithBun: UpdateInstaller = (target) => {
	const proc = Bun.spawnSync(["bun", "add", "-g", target], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	return { exitCode: proc.exitCode };
};

const parseVersion = (
	version: string,
): { readonly main: readonly [number, number, number]; readonly prerelease?: string } | null => {
	const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.+)?$/);
	if (!match) return null;
	const major = Number.parseInt(match[1]!, 10);
	const minor = Number.parseInt(match[2]!, 10);
	const patch = Number.parseInt(match[3]!, 10);
	if (![major, minor, patch].every(Number.isSafeInteger)) return null;
	return {
		main: [major, minor, patch],
		...(match[4] ? { prerelease: match[4] } : {}),
	};
};

const comparePrerelease = (left: string, right: string): -1 | 0 | 1 => {
	const a = left.split(".");
	const b = right.split(".");
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const leftPart = a[i];
		const rightPart = b[i];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		if (leftPart === rightPart) continue;

		const leftNumber = parseNumericIdentifier(leftPart);
		const rightNumber = parseNumericIdentifier(rightPart);
		if (leftNumber !== null && rightNumber !== null) {
			return leftNumber < rightNumber ? -1 : 1;
		}
		if (leftNumber !== null) return -1;
		if (rightNumber !== null) return 1;
		return leftPart < rightPart ? -1 : 1;
	}
	return 0;
};

const parseNumericIdentifier = (value: string): number | null => {
	if (!/^(0|[1-9]\d*)$/.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isSafeInteger(parsed) ? parsed : null;
};
