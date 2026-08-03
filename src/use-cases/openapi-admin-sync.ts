import { resolve } from "node:path";
import { Effect } from "effect";
import type { ParsedAdminAuthConfig, AdminPresentationDefaults } from "../domain/openapi-models";
import { AdminProcessRunner } from "../ports/admin-process-runner";
import { GeneratorRegistry } from "../ports/generator-registry";
import {
	diffAdminAppPlans,
	type AdminAppPlanLike,
	type OpenApiAdminPlanDiff,
} from "./openapi-admin-diff";
import {
	commitAdminManifestApplied,
	preflightAdminGeneratedFiles,
	readAdminManifestMetadata,
	readAdminManifestSnapshot,
	refreshAdminGeneratedFileHashes,
	type AdminWriteResult,
	writeAdminGeneratedFiles,
} from "./openapi-admin-manifest";
import { planAdminTargetedQualityCommands } from "./openapi-admin-quality";
import type { AdminFramework } from "./openapi-admin-scaffold";
import { prepareAdminSyncCandidate, type AdminSyncCandidate } from "./openapi-admin-service";

export type OpenApiAdminSyncMode = "plan" | "apply" | "check";

export interface OpenApiAdminSyncCandidate<State = unknown> {
	fingerprint: string;
	state: State;
}

export interface OpenApiAdminAppliedState<State = unknown> {
	fingerprint: string | null;
	state: State | null;
}

/** Implementations must only read and prepare the desired generated state. */
export interface OpenApiAdminSyncLoader<State = unknown> {
	load(): Promise<OpenApiAdminSyncCandidate<State>>;
}

/** Implementations should return stable, human-readable change identifiers. */
export interface OpenApiAdminSyncDiff<State = unknown> {
	compare(previous: State | null, desired: State): Promise<readonly string[]>;
}

/** Conflict detection is part of preflight and must not modify the target project. */
export interface OpenApiAdminSyncConflictDetector<State = unknown> {
	detect(
		candidate: OpenApiAdminSyncCandidate<State>,
		applied: OpenApiAdminAppliedState<State>,
	): Promise<readonly string[]>;
}

export interface OpenApiAdminSyncApplier<State = unknown> {
	apply(candidate: OpenApiAdminSyncCandidate<State>): Promise<readonly string[] | void>;
}

/** Quality checks must be read-only when invoked in check mode. */
export interface OpenApiAdminSyncQuality<State = unknown> {
	check(
		candidate: OpenApiAdminSyncCandidate<State>,
		mode: "apply" | "check",
	): Promise<readonly string[]>;
}

export interface OpenApiAdminSyncManifest<State = unknown> {
	loadApplied(): Promise<OpenApiAdminAppliedState<State>>;
	commitApplied(candidate: OpenApiAdminSyncCandidate<State>): Promise<void>;
}

export interface OpenApiAdminSyncDependencies<State = unknown> {
	loader: OpenApiAdminSyncLoader<State>;
	diff: OpenApiAdminSyncDiff<State>;
	conflicts: OpenApiAdminSyncConflictDetector<State>;
	applier: OpenApiAdminSyncApplier<State>;
	quality: OpenApiAdminSyncQuality<State>;
	manifest: OpenApiAdminSyncManifest<State>;
}

export type OpenApiAdminSyncStatus = "clean" | "drift" | "blocked" | "applied" | "quality-failed";

export interface OpenApiAdminSyncResult {
	mode: OpenApiAdminSyncMode;
	status: OpenApiAdminSyncStatus;
	drift: boolean;
	fingerprintChanged: boolean;
	applied: boolean;
	committed: boolean;
	appliedFingerprint: string | null;
	desiredFingerprint: string;
	changes: readonly string[];
	conflicts: readonly string[];
	qualityIssues: readonly string[];
}

const normalized = (values: readonly string[]): readonly string[] =>
	[...new Set(values)].sort((left, right) => left.localeCompare(right));

/**
 * Coordinates synchronization without knowing about filesystems, OpenAPI parsing,
 * or process execution. Dependency implementations own those integration details.
 */
export const runOpenApiAdminSync = async <State>(
	mode: OpenApiAdminSyncMode,
	dependencies: OpenApiAdminSyncDependencies<State>,
): Promise<OpenApiAdminSyncResult> => {
	const [candidate, applied] = await Promise.all([
		dependencies.loader.load(),
		dependencies.manifest.loadApplied(),
	]);
	const [rawChanges, rawConflicts] = await Promise.all([
		dependencies.diff.compare(applied.state, candidate.state),
		dependencies.conflicts.detect(candidate, applied),
	]);
	const changes = normalized(rawChanges);
	const conflicts = normalized(rawConflicts);
	const fingerprintChanged = applied.fingerprint !== candidate.fingerprint;
	const drift = fingerprintChanged || changes.length > 0 || conflicts.length > 0;
	const base = {
		mode,
		drift,
		fingerprintChanged,
		applied: false,
		committed: false,
		appliedFingerprint: applied.fingerprint,
		desiredFingerprint: candidate.fingerprint,
		changes,
		conflicts,
		qualityIssues: [] as readonly string[],
	};

	if (mode === "plan") {
		return { ...base, status: drift ? "drift" : "clean" };
	}

	if (mode === "check") {
		const qualityIssues = normalized(await dependencies.quality.check(candidate, "check"));
		return {
			...base,
			status: qualityIssues.length > 0 ? "quality-failed" : drift ? "drift" : "clean",
			qualityIssues,
		};
	}

	if (!drift) return { ...base, status: "clean" };
	if (conflicts.length > 0) return { ...base, status: "blocked" };

	const lateConflicts = normalized((await dependencies.applier.apply(candidate)) ?? []);
	if (lateConflicts.length > 0) {
		return {
			...base,
			status: "blocked",
			conflicts: lateConflicts,
		};
	}
	const qualityIssues = normalized(await dependencies.quality.check(candidate, "apply"));
	if (qualityIssues.length > 0) {
		return {
			...base,
			status: "quality-failed",
			applied: true,
			qualityIssues,
		};
	}

	await dependencies.manifest.commitApplied(candidate);
	return {
		...base,
		status: "applied",
		applied: true,
		committed: true,
		appliedFingerprint: candidate.fingerprint,
	};
};

export interface SyncAdminProjectInput {
	input: string;
	output: string;
	framework: AdminFramework;
	mode: OpenApiAdminSyncMode;
	auth?: ParsedAdminAuthConfig;
	preset?: string;
	createMode?: "page" | "dialog";
	presentation?: Partial<AdminPresentationDefaults>;
}

export interface SyncAdminProjectResult {
	diff: string[];
	conflicts: string[];
	changed: boolean;
	status: OpenApiAdminSyncStatus;
	qualityIssues: string[];
}

const displayResource = (resource: { key?: string; id?: string }): string =>
	resource.key ?? resource.id ?? "<unknown>";

const displayOperation = (operation: {
	kind: string;
	operationId?: string;
	path?: string;
}): string => [operation.kind, operation.operationId, operation.path].filter(Boolean).join(" ");

const flattenAdminPlanDiff = (diff: OpenApiAdminPlanDiff): string[] => {
	const lines: string[] = [];
	for (const resource of diff.resources.added)
		lines.push(`resource added: ${displayResource(resource)}`);
	for (const resource of diff.resources.removed)
		lines.push(`resource removed: ${displayResource(resource)}`);
	for (const change of diff.resources.changed) {
		const resource = displayResource(change.resource);
		for (const property of Object.keys(change.identityChanges))
			lines.push(`resource ${resource} identity changed: ${property}`);
		for (const property of Object.keys(change.propertyChanges))
			lines.push(`resource ${resource} property changed: ${property}`);
		for (const operation of change.operations.added)
			lines.push(`resource ${resource} operation added: ${displayOperation(operation)}`);
		for (const operation of change.operations.removed)
			lines.push(`resource ${resource} operation removed: ${displayOperation(operation)}`);
		for (const operation of change.operations.changed)
			lines.push(`resource ${resource} operation changed: ${operation.kind}`);
		for (const field of change.fields.added)
			lines.push(`resource ${resource} field added: ${field.scope}.${field.name}`);
		for (const field of change.fields.removed)
			lines.push(`resource ${resource} field removed: ${field.scope}.${field.name}`);
		for (const field of change.fields.changed)
			lines.push(`resource ${resource} field changed: ${field.scope}.${field.name}`);
		if (change.presentation) lines.push(`resource ${resource} presentation changed`);
	}
	if (diff.navigation) lines.push("navigation changed");
	if (diff.presentation) lines.push("presentation changed");
	return normalized(lines) as string[];
};

interface AdminProjectSyncState {
	plan: AdminAppPlanLike | null;
	candidate: AdminSyncCandidate | null;
	overlayFingerprint: string | null;
}

const qualityIssue = (error: unknown, argv: readonly string[]): string => {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return `${argv.join(" ")} failed`;
};

/** Synchronizes a generated project while only committing a candidate after quality succeeds. */
export const syncAdminProject = (
	input: SyncAdminProjectInput,
): Effect.Effect<SyncAdminProjectResult, any, AdminProcessRunner | GeneratorRegistry> =>
	Effect.gen(function* () {
		const outputDir = resolve(input.output);
		const runner = yield* AdminProcessRunner;
		const registry = yield* GeneratorRegistry;
		let preflight: Promise<AdminWriteResult> | undefined;
		let writeResult: AdminWriteResult | undefined;
		let packageManager: "bun" | "pnpm" = "bun";
		const getPreflight = (candidate: AdminSyncCandidate): Promise<AdminWriteResult> => {
			preflight ??= Promise.resolve().then(() =>
				preflightAdminGeneratedFiles(outputDir, candidate.files),
			);
			return preflight;
		};

		const result = yield* Effect.tryPromise(() =>
			runOpenApiAdminSync<AdminProjectSyncState>(input.mode, {
				loader: {
					load: async () => {
						const candidate = await Effect.runPromise(
							(
								prepareAdminSyncCandidate(input) as Effect.Effect<
									AdminSyncCandidate,
									any,
									GeneratorRegistry
								>
							).pipe(Effect.provideService(GeneratorRegistry, registry)),
						);
						return {
							fingerprint: candidate.specFingerprint,
							state: {
								plan: candidate.plan as unknown as AdminAppPlanLike,
								candidate,
								overlayFingerprint: candidate.overlayFingerprint ?? null,
							},
						};
					},
				},
				diff: {
					compare: async (previous, desired) => {
						const planDiff = flattenAdminPlanDiff(
							diffAdminAppPlans(previous?.plan ?? null, desired.plan),
						);
						const candidate = desired.candidate;
						if (!candidate) throw new Error("admin sync candidate is unavailable");
						const result = await getPreflight(candidate);
						return [
							...(previous?.overlayFingerprint === desired.overlayFingerprint
								? []
								: ["admin UI overlay changed"]),
							...planDiff,
							...result.written.map((path) => `file written: ${path}`),
							...result.deleted.map((path) => `file deleted: ${path}`),
						];
					},
				},
				conflicts: {
					detect: async ({ state }) => {
						const candidate = state.candidate;
						if (!candidate) throw new Error("admin sync candidate is unavailable");
						return (await getPreflight(candidate)).conflicts;
					},
				},
				applier: {
					apply: async ({ state }) => {
						const candidate = state.candidate;
						if (!candidate) throw new Error("admin sync candidate is unavailable");
						const previousMetadata = readAdminManifestMetadata(outputDir);
						packageManager = previousMetadata?.packageManager ?? packageManager;
						writeResult = writeAdminGeneratedFiles(
							outputDir,
							candidate.files,
							{
								framework: input.framework,
								packageManager,
								specFingerprint: candidate.specFingerprint,
								specSource: input.input,
								preset: input.preset ?? previousMetadata?.preset,
								createMode: input.createMode ?? previousMetadata?.createMode,
								adminPlanSnapshot: candidate.plan,
								overlayFingerprint: candidate.overlayFingerprint ?? null,
							},
							{ deferAppliedFingerprint: true },
						);
						return writeResult.conflicts;
					},
				},
				quality: {
					check: async (_candidate, mode) => {
						const commands =
							mode === "check"
								? [[packageManager, "run", "check"]]
								: planAdminTargetedQualityCommands(packageManager, writeResult?.written ?? []);
						for (const argv of commands) {
							try {
								await Effect.runPromise(runner.run(argv, outputDir));
							} catch (error) {
								return [qualityIssue(error, argv)];
							} finally {
								if (mode === "apply" && writeResult)
									refreshAdminGeneratedFileHashes(outputDir, writeResult.written);
							}
						}
						return [];
					},
				},
				manifest: {
					loadApplied: async () => {
						const snapshot = readAdminManifestSnapshot(outputDir);
						const metadata = readAdminManifestMetadata(outputDir);
						packageManager = metadata?.packageManager ?? "bun";
						return {
							fingerprint: snapshot.appliedFingerprint,
							state: {
								plan: snapshot.adminPlanSnapshot as AdminAppPlanLike | null,
								candidate: null,
								overlayFingerprint: metadata?.overlayFingerprint ?? null,
							},
						};
					},
					commitApplied: async ({ fingerprint, state }) => {
						commitAdminManifestApplied(outputDir, fingerprint, state.plan);
					},
				},
			}),
		);

		return {
			diff: [...result.changes],
			conflicts: [...result.conflicts],
			changed: result.drift,
			status: result.status,
			qualityIssues: [...result.qualityIssues],
		};
	});
