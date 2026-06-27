import { dirname } from "node:path";
import { Effect } from "effect";
import { FileError } from "../domain/errors";
import type { PlannerSnapshot } from "../domain/planner-model";
import { resolvePlannerSnapshotCachePath } from "../adapters/app-paths";

const readPlannerSnapshotCacheByPath = (
	path: string,
): Effect.Effect<PlannerSnapshot | null, FileError> =>
	Effect.tryPromise({
		try: async () => {
			const file = Bun.file(path);
			if (!(await file.exists())) return null;
			return JSON.parse(await file.text()) as PlannerSnapshot;
		},
		catch: (cause) => new FileError({ message: `Failed to read planner cache: ${String(cause)}` }),
	});

export const loadPlannerSnapshotCache = (
	account: string,
	board: string,
): Effect.Effect<null | PlannerSnapshot, FileError> => {
	const path = resolvePlannerSnapshotCachePath(account, board);
	return Effect.gen(function* () {
		const raw = yield* readPlannerSnapshotCacheByPath(path);
		if (raw === null) return null;
		return { ...raw, cache: "stale" as const };
	});
};

export const writePlannerSnapshotCache = (
	snapshot: PlannerSnapshot,
): Effect.Effect<void, FileError> =>
	Effect.tryPromise({
		try: async () => {
			const path = resolvePlannerSnapshotCachePath(snapshot.account, snapshot.board);
			await import("node:fs/promises").then((fs) => fs.mkdir(dirname(path), { recursive: true }));
			await Bun.write(path, `${JSON.stringify({ ...snapshot, cache: "fresh" }, null, 2)}\n`);
		},
		catch: (cause) => new FileError({ message: `Failed to write planner cache: ${String(cause)}` }),
	});
