import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Effect } from "effect";
import { ValidationError } from "../domain/errors";
import type { DevBranchMetadata } from "../domain/models";
import { gitCommand, requireGitCommand } from "./git-command";

export interface WorktreeEntry {
	status: string;
	path: string;
	fingerprint?: string;
}

export interface DevBaseline {
	version: 1;
	branch: string;
	head: string;
	capturedAt: string;
	entries: ReadonlyArray<WorktreeEntry>;
}

export interface DevReadyReceipt {
	version: 1;
	branch: string;
	head: string;
	base: string;
	mode: "ready" | "full";
	checks: ReadonlyArray<string>;
	createdAt: string;
}

const runGitResult = (args: ReadonlyArray<string>) => gitCommand.run(args);

const requireGit = (args: ReadonlyArray<string>) => requireGitCommand(args);

const requireGitRaw = (args: ReadonlyArray<string>, cwd?: string) =>
	requireGitCommand(args, { raw: true, cwd });

const gitStatePath = (kind: "baselines" | "ready" | "drafts", name?: string, cwd?: string) =>
	Effect.gen(function* () {
		const gitPath = yield* requireGitCommand(["rev-parse", "--git-path", `fizzyx/${kind}`], {
			cwd,
		});
		const directory = resolve(cwd ?? process.cwd(), gitPath);
		return name ? join(directory, `${stateName(name)}.json`) : directory;
	});

const safeName = (value: string): string =>
	value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "state";

const stateName = (value: string, label: string = value): string => {
	const digest = createHash("sha256").update(value).digest("hex").slice(0, 12);
	return `${safeName(label).slice(0, 80)}-${digest}`;
};

const readJson = <A>(path: string): Effect.Effect<A | undefined, ValidationError> =>
	Effect.tryPromise({
		try: async () => {
			try {
				return JSON.parse(await readFile(path, "utf8")) as A;
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
				throw cause;
			}
		},
		catch: (cause) =>
			new ValidationError({ message: `Failed to read local dev state ${path}: ${String(cause)}` }),
	});

const writeJson = (path: string, value: unknown): Effect.Effect<void, ValidationError> =>
	Effect.tryPromise({
		try: async () => {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		},
		catch: (cause) =>
			new ValidationError({ message: `Failed to write local dev state ${path}: ${String(cause)}` }),
	});

export const readBranchMetadata = (
	branch: string,
): Effect.Effect<DevBranchMetadata | undefined, ValidationError> =>
	Effect.gen(function* () {
		const prefix = `branch.${branch}.fizzyx-`;
		const [card, kind, base, createdAt] = yield* Effect.all([
			runGitResult(["config", "--local", "--get", `${prefix}card`]),
			runGitResult(["config", "--local", "--get", `${prefix}kind`]),
			runGitResult(["config", "--local", "--get", `${prefix}base`]),
			runGitResult(["config", "--local", "--get", `${prefix}created-at`]),
		]);
		if ([card, kind, base, createdAt].every((item) => item.exitCode !== 0)) return undefined;
		return {
			card: card.stdout.trim() ? Number(card.stdout.trim()) : undefined,
			kind: kind.stdout.trim() || undefined,
			base: base.stdout.trim() || undefined,
			createdAt: createdAt.stdout.trim() || undefined,
		};
	});

export const writeBranchMetadata = (
	branch: string,
	metadata: DevBranchMetadata,
): Effect.Effect<void, ValidationError> =>
	Effect.gen(function* () {
		const prefix = `branch.${branch}.fizzyx-`;
		const values: ReadonlyArray<readonly [string, string | number | undefined]> = [
			["card", metadata.card],
			["kind", metadata.kind],
			["base", metadata.base],
			["created-at", metadata.createdAt],
		];
		yield* Effect.forEach(
			values.filter((entry) => entry[1] !== undefined),
			([key, value]) => requireGit(["config", "--local", `${prefix}${key}`, String(value)]),
			{ discard: true },
		);
	});

const fingerprint = async (path: string): Promise<string | undefined> => {
	try {
		const bytes = await Bun.file(path).arrayBuffer();
		return createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
	} catch {
		return undefined;
	}
};

export const snapshotWorktree = (
	cwd?: string,
): Effect.Effect<ReadonlyArray<WorktreeEntry>, ValidationError> =>
	Effect.gen(function* () {
		const output = yield* requireGitRaw(
			["-c", "core.quotepath=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
			cwd,
		);
		if (!output) return [];
		const records = output.split("\0");
		const entries: Array<{ status: string; path: string }> = [];
		for (let index = 0; index < records.length; index += 1) {
			const record = records[index];
			if (!record) continue;
			const status = record.slice(0, 2);
			entries.push({ status, path: record.slice(3) });
			if (status.includes("R") || status.includes("C")) index += 1;
		}
		return yield* Effect.forEach(entries, (entry) =>
			Effect.promise(async () => {
				const absolute = cwd ? join(cwd, entry.path) : entry.path;
				return { ...entry, fingerprint: await fingerprint(absolute) };
			}),
		);
	});

export const readBaseline = (branch: string) =>
	gitStatePath("baselines", branch).pipe(Effect.flatMap((path) => readJson<DevBaseline>(path)));

export const writeBaseline = (branch: string, options?: { cwd?: string }) =>
	Effect.gen(function* () {
		const [head, entries, path] = yield* Effect.all([
			requireGitCommand(["rev-parse", "HEAD"], { cwd: options?.cwd }),
			snapshotWorktree(options?.cwd),
			gitStatePath("baselines", branch, options?.cwd),
		]);
		const baseline: DevBaseline = {
			version: 1,
			branch,
			head,
			capturedAt: new Date().toISOString(),
			entries,
		};
		yield* writeJson(path, baseline);
		return baseline;
	});

export interface WorktreeInfo {
	path: string;
	branch?: string;
}

export const resolveWorktreePath = (branch: string): Effect.Effect<string, ValidationError> =>
	Effect.gen(function* () {
		const commonDir = yield* requireGit(["rev-parse", "--git-common-dir"]);
		const absoluteCommon = resolve(process.cwd(), commonDir);
		return join(absoluteCommon, "fizzyx", "worktrees", safeName(branch));
	});

export const listWorktrees = (): Effect.Effect<ReadonlyArray<WorktreeInfo>, ValidationError> =>
	Effect.gen(function* () {
		const output = yield* requireGitRaw(["worktree", "list", "--porcelain"]);
		const infos: WorktreeInfo[] = [];
		let current: Partial<WorktreeInfo> = {};
		for (const line of output.split("\n")) {
			if (line.startsWith("worktree ")) {
				if (current.path) infos.push(current as WorktreeInfo);
				current = { path: line.slice("worktree ".length) };
			} else if (line.startsWith("branch ")) {
				current.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
			} else if (line === "") {
				if (current.path) infos.push(current as WorktreeInfo);
				current = {};
			}
		}
		if (current.path) infos.push(current as WorktreeInfo);
		return infos;
	});

export const partitionWorktree = (
	entries: ReadonlyArray<WorktreeEntry>,
	baseline: DevBaseline | undefined,
): { blocking: ReadonlyArray<WorktreeEntry>; baseline: ReadonlyArray<WorktreeEntry> } => {
	if (!baseline) return { blocking: entries, baseline: [] };
	const original = new Map(
		baseline.entries.map((entry) => [`${entry.status}\0${entry.path}`, entry] as const),
	);
	const unchanged: WorktreeEntry[] = [];
	const blocking: WorktreeEntry[] = [];
	for (const entry of entries) {
		const before = original.get(`${entry.status}\0${entry.path}`);
		if (before && before.fingerprint === entry.fingerprint) unchanged.push(entry);
		else blocking.push(entry);
	}
	return { blocking, baseline: unchanged };
};

export const readReadyReceipt = (branch: string) =>
	gitStatePath("ready", branch).pipe(Effect.flatMap((path) => readJson<DevReadyReceipt>(path)));

export const writeReadyReceipt = (receipt: DevReadyReceipt): Effect.Effect<void, ValidationError> =>
	gitStatePath("ready", receipt.branch).pipe(Effect.flatMap((path) => writeJson(path, receipt)));

export const removeReadyReceipt = (branch: string): Effect.Effect<void, ValidationError> =>
	gitStatePath("ready", branch).pipe(
		Effect.flatMap((path) =>
			Effect.tryPromise({
				try: () => rm(path, { force: true }),
				catch: (cause) =>
					new ValidationError({ message: `Failed to clear ready receipt: ${String(cause)}` }),
			}),
		),
	);

export const removeBranchState = (branch: string): Effect.Effect<void, ValidationError> =>
	Effect.gen(function* () {
		const [baselinePath, readyPath] = yield* Effect.all([
			gitStatePath("baselines", branch),
			gitStatePath("ready", branch),
		]);
		yield* Effect.tryPromise({
			try: () => Promise.all([rm(baselinePath, { force: true }), rm(readyPath, { force: true })]),
			catch: (cause) =>
				new ValidationError({ message: `Failed to clear local branch state: ${String(cause)}` }),
		});
	});

export const resolveUserStateRoot = (
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
	home: string = homedir(),
): string => {
	if (platform === "win32") return env.LOCALAPPDATA || join(home, "AppData", "Local");
	return env.XDG_STATE_HOME || join(home, ".local", "state");
};

export const resolveDraftDirectory = (): Effect.Effect<string, ValidationError> =>
	gitStatePath("drafts").pipe(
		Effect.catch(() =>
			Effect.sync(() => {
				const cwd = process.cwd();
				const project = stateName(cwd, basename(cwd));
				return join(resolveUserStateRoot(), "fizzyx", "drafts", project);
			}),
		),
	);
