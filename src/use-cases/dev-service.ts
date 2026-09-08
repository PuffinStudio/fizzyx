import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Effect } from "effect";
import { ConfigError, FileError, ValidationError } from "../domain/errors";
import type { DevBranchMetadata, DevConfig, ProjectConfig } from "../domain/models";
import type { ConfigRepository } from "../ports/config-repository";
import { ConfigRepo } from "../ports/config-repository";
import {
  listWorktrees,
  partitionWorktree,
  readBaseline,
  readBranchMetadata,
  readReadyReceipt,
  removeBranchState,
  removeReadyReceipt,
  resolveWorktreePath,
  snapshotWorktree,
  writeBaseline,
  writeBranchMetadata,
  writeReadyReceipt,
  type DevBaseline,
} from "../adapters/git-dev-state";
import { gitCommand, requireGitCommand } from "../adapters/git-command";

export type BranchRole = "protected" | "environment" | "feature" | "maintenance" | "unknown";

export interface DevStatus {
  currentBranch: string;
  role: BranchRole;
  baseBranch: string;
  dirty: boolean;
  dirtyFiles: ReadonlyArray<string>;
  baselineFiles: ReadonlyArray<string>;
  baselineAvailable: boolean;
  ahead: number;
  /** Deprecated alias of {@link DevStatus.behindBase}; kept for one release. */
  behind: number;
  /** Commits on the base ref that HEAD does not have. */
  behindBase: number;
  /** Commits on the branch's own upstream that HEAD does not have; 0 without an upstream. */
  behindUpstream: number;
  hasUpstream: boolean;
  card?: number;
  nextAction?: string;
  promotionReady?: boolean;
}

export interface DevReadyResult {
  ready: boolean;
  blockedReasons: ReadonlyArray<string>;
  checksRun: ReadonlyArray<CheckResult>;
  suggestedPromotion?: string;
}

export interface CheckResult {
  name: string;
  passed: boolean;
  output: string;
}

export interface PromotionCheck {
  passed: boolean;
  reason: string;
}

export interface DoctorReport {
  staleBranches: ReadonlyArray<DoctorBranchInfo>;
  noUpstreamBranches: ReadonlyArray<DoctorBranchInfo>;
  mergedBranches: ReadonlyArray<DoctorBranchInfo>;
  environmentAhead: ReadonlyArray<DoctorBranchInfo>;
  wipOnReady: ReadonlyArray<DoctorBranchInfo>;
  protectedDirty: ReadonlyArray<DoctorBranchInfo>;
  featureOnEnvBase: ReadonlyArray<DoctorBranchInfo>;
  worktrees: ReadonlyArray<DoctorBranchInfo>;
}

export interface DoctorBranchInfo {
  name: string;
  detail: string;
}

export interface GitCommand {
  command: string;
  description: string;
}

type DevEffect<A> = Effect.Effect<A, ConfigError | FileError | ValidationError, ConfigRepository>;

const WIP_COMMIT_GREP = "^wip[:(]";
const AGENT_DIRTY_POLICY =
  "Record dirty_files before editing. Commit or checkpoint only changes made in this task; do not commit pre-existing user changes without explicit approval.";

const runGit = (
  args: ReadonlyArray<string>,
  cwd?: string,
): Effect.Effect<string, ValidationError> =>
  requireGitCommand(args, { cwd, errorPrefix: `Git command failed: git ${args.join(" ")}` });

const runGitNoThrow = (
  args: ReadonlyArray<string>,
  cwd?: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, ValidationError> =>
  gitCommand.run(args, { cwd }).pipe(
    Effect.map((result) => ({
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
      exitCode: result.exitCode,
    })),
  );

export const resolveDevShellCommand = (
  command: string,
  platform: NodeJS.Platform = process.platform,
): string[] =>
  platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", "/d", "/s", "/c", command]
    : ["bash", "-c", command];

/** Compilers and test runners write their failures to stderr, so it has to be captured. */
const runShell = (
  command: string,
): Effect.Effect<{ stdout: string; stderr: string; exitCode: number }, ValidationError> =>
  Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn({
        cmd: resolveDevShellCommand(command),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
    },
    catch: (cause) =>
      new ValidationError({ message: `Shell command failed: ${command} — ${String(cause)}` }),
  });

const CHECK_OUTPUT_LIMIT = 2000;

const truncateCheckOutput = (value: string): string =>
  value.length <= CHECK_OUTPUT_LIMIT
    ? value
    : `${value.slice(0, CHECK_OUTPUT_LIMIT)}\n… (output truncated)`;

const classifyBranch = (branch: string, config: DevConfig | undefined): BranchRole => {
  const protectedBranches = config?.protectedBranches ?? ["main", "master", "production", "stable"];
  for (const p of protectedBranches) {
    if (p.endsWith("/*")) {
      if (branch.startsWith(p.slice(0, -1))) return "protected";
    } else if (branch === p) {
      return "protected";
    }
  }

  if (config?.environmentBranches && branch in config.environmentBranches) {
    return "environment";
  }

  if (config?.branchPrefixes) {
    for (const [, prefix] of Object.entries(config.branchPrefixes)) {
      if (branch.startsWith(`${prefix}/`)) {
        return prefix === "fix" || prefix === "feature" || prefix === "hotfix" || prefix === "docs"
          ? "feature"
          : "maintenance";
      }
    }
  }

  if (
    /^(feature|feat|fix|bugfix|hotfix|ops|chore|docs|doc|maintenance|refactor|test|ci|build)\//.test(
      branch,
    )
  ) {
    return branch.startsWith("fix/") ||
      branch.startsWith("bugfix/") ||
      branch.startsWith("feature/") ||
      branch.startsWith("feat/") ||
      branch.startsWith("hotfix/") ||
      branch.startsWith("docs/") ||
      branch.startsWith("doc/")
      ? "feature"
      : "maintenance";
  }

  return "unknown";
};

const getBranchMetadata = (
  branch: string,
  config: DevConfig | undefined,
): DevBranchMetadata | undefined => {
  const configured = config?.branches?.[branch];
  if (configured) return configured;
  const card = branch.match(/(?:^|\/)card-(\d+)(?:-|$)/)?.[1];
  if (!card) return undefined;
  return {
    card: Number(card),
    kind: getBranchNameKind(branch, config),
    base: config?.defaultBase ?? config?.productionBranch ?? "main",
  };
};

const kindLabel = (role: BranchRole): string => {
  switch (role) {
    case "protected":
      return "protected";
    case "environment":
      return "environment";
    case "feature":
      return "feature";
    case "maintenance":
      return "maintenance";
    case "unknown":
      return "unknown";
  }
};

export const loadConfig = (): DevEffect<ProjectConfig> =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepo;
    return yield* configRepo.loadProjectConfig();
  });

export const loadConfigOptional = (): Effect.Effect<
  ProjectConfig | undefined,
  never,
  ConfigRepository
> => loadConfig().pipe(Effect.catch(() => Effect.succeed(undefined as ProjectConfig | undefined)));

interface ResolvedBase {
  /** Configured base branch name, e.g. "main". This is what status reports as `base`. */
  name: string;
  /**
   * The ref actually compared and rebased against. `git fetch` advances `origin/<base>`
   * and never the local `<base>`, so measuring or rebasing against the local branch made
   * `sync` a no-op and let `ready` certify a branch that was days behind the remote.
   */
  ref: string;
}

const baseBranchName = (config: ProjectConfig | undefined): string =>
  config?.dev?.defaultBase ?? config?.dev?.productionBranch ?? "main";

const resolveBaseRef = (
  config: ProjectConfig | undefined,
): Effect.Effect<ResolvedBase, ValidationError> =>
  Effect.gen(function* () {
    const name = baseBranchName(config);
    // Opt-out for repositories that deliberately track a local base branch.
    if (config?.dev?.syncFromRemote === false) return { name, ref: name };
    const remoteRef = `origin/${name}`;
    const found = yield* runGitNoThrow([
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/remotes/${remoteRef}`,
    ]);
    // A purely local repository has no remote-tracking ref; fall back to the local branch.
    return { name, ref: found.exitCode === 0 ? remoteRef : name };
  });

/**
 * True when HEAD points straight at a commit instead of a branch. Commits created in that
 * state are reachable from no ref, so mutating commands have to refuse or say so.
 */
const isDetachedHead = (): Effect.Effect<boolean, ValidationError> =>
  runGitNoThrow(["symbolic-ref", "--quiet", "HEAD"]).pipe(Effect.map((r) => r.exitCode !== 0));

export const getCurrentBranch = (): Effect.Effect<string, ValidationError> =>
  Effect.gen(function* () {
    const branch = yield* runGit(["branch", "--show-current"]);
    if (branch) return branch;
    const hash = yield* runGit(["rev-parse", "--short", "HEAD"]).pipe(
      Effect.catch(() => Effect.succeed("(unknown)")),
    );
    return `detached/${hash}`;
  });

export const getStatus = (config?: ProjectConfig): Effect.Effect<DevStatus, ValidationError> =>
  Effect.gen(function* () {
    const currentBranch = yield* getCurrentBranch();

    const entries = yield* snapshotWorktree();
    const baseline = yield* readBaseline(currentBranch);
    const partitioned = partitionWorktree(entries, baseline);
    const dirtyFiles = partitioned.blocking.map((entry) => `${entry.status} ${entry.path}`);
    const baselineFiles = partitioned.baseline.map((entry) => `${entry.status} ${entry.path}`);
    const dirty = dirtyFiles.length > 0;

    const devConfig = config?.dev;
    if (devConfig?.branches) {
      yield* Effect.forEach(
        Object.entries(devConfig.branches),
        ([branch, legacy]) =>
          readBranchMetadata(branch).pipe(
            Effect.flatMap((local) =>
              local ? Effect.succeed(undefined) : writeBranchMetadata(branch, legacy),
            ),
          ),
        { discard: true },
      );
    }
    const resolvedBase = yield* resolveBaseRef(config);
    const baseBranch = resolvedBase.name;

    const countRevs = (range: string): Effect.Effect<number, never> =>
      runGit(["rev-list", "--count", range]).pipe(
        Effect.catch(() => Effect.succeed("0")),
        Effect.map((value) => Number(value) || 0),
      );

    const hasUpstream = yield* runGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]).pipe(
      Effect.catch(() => Effect.succeed("")),
      Effect.map((v) => v.length > 0),
    );

    // Without an upstream, `@{u}..HEAD` fails and used to be hard-coded to 0 — which is the
    // state of every branch `dev start` has just created, so unpushed work always read as
    // "ahead: 0". Fall back to the base ref instead.
    const ahead = hasUpstream
      ? yield* countRevs("@{u}..HEAD")
      : yield* countRevs(`${resolvedBase.ref}..HEAD`);
    const behindBase = yield* countRevs(`HEAD..${resolvedBase.ref}`);
    const behindUpstream = hasUpstream ? yield* countRevs("HEAD..@{u}") : 0;
    // `behind` used to mean the upstream distance when an upstream existed and the base
    // distance otherwise, while always being labelled "base". It is kept as an alias of
    // behind_base so existing agent parsers keep working for one release.
    const behind = behindBase;

    const detached = yield* isDetachedHead();
    const role = classifyBranch(currentBranch, devConfig);
    const meta =
      (yield* readBranchMetadata(currentBranch)) ?? getBranchMetadata(currentBranch, devConfig);

    const nextAction = computeNextAction(
      role,
      dirty,
      ahead,
      behind,
      currentBranch,
      baseBranch,
      detached,
    );
    const promotionReady = role !== "protected" && role !== "unknown" && !dirty && behind === 0;

    return {
      currentBranch,
      role,
      baseBranch,
      dirty,
      dirtyFiles,
      baselineFiles,
      baselineAvailable: baseline !== undefined,
      ahead,
      behind,
      behindBase,
      behindUpstream,
      hasUpstream,
      card: meta?.card,
      nextAction,
      promotionReady,
    };
  });

const computeNextAction = (
  role: BranchRole,
  dirty: boolean,
  ahead: number,
  behind: number,
  _branch: string,
  _base: string,
  detached = false,
): string => {
  if (detached) {
    return "HEAD is detached, so commits made here are reachable from no branch. Run 'git switch <branch>' (or 'git switch -c <new-branch>') before checkpointing.";
  }
  if (role === "protected") {
    return dirty
      ? "Working tree is dirty on a protected branch. Preserve pre-existing changes, or move your own edits to a proper work branch before committing."
      : `Run 'fizzyx dev start <slug> --kind feature' to start work.`;
  }
  if (dirty) {
    return "If these are your task edits, stage only your files and run 'fizzyx dev checkpoint' or commit properly. If they pre-existed, stop and ask.";
  }
  if (behind > 0) {
    return "Branch is behind base. Run 'fizzyx dev sync' to rebase.";
  }
  if (ahead > 0) {
    return "Branch has unpushed commits. Run 'fizzyx dev ready' when reviewable, or 'fizzyx dev promote <branch> --to <env> --dry-run' to promote.";
  }
  return "Branch is clean. Run 'fizzyx dev start <slug>' or 'fizzyx dev checkpoint' after edits.";
};

export const formatStatus = (status: DevStatus, agent: boolean): string => {
  if (agent) {
    const lines: string[] = [
      `branch: ${status.currentBranch}`,
      `role: ${kindLabel(status.role)}`,
      `base: ${status.baseBranch}`,
      `dirty: ${status.dirty ? "yes" : "no"}`,
      `ahead: ${status.ahead}`,
      `behind: ${status.behind}`,
      `behind_base: ${status.behindBase}`,
      `behind_upstream: ${status.behindUpstream}`,
      `has_upstream: ${status.hasUpstream ? "yes" : "no"}`,
      `dirty_policy: ${AGENT_DIRTY_POLICY}`,
      `baseline: ${status.baselineAvailable ? "available" : "missing"}`,
    ];
    if (status.card) lines.push(`card: ${status.card}`);
    if (status.nextAction) lines.push(`next_action: ${status.nextAction}`);
    if (status.promotionReady !== undefined) {
      lines.push(`promotion_ready: ${status.promotionReady ? "yes" : "no"}`);
    }
    if (status.dirty && status.dirtyFiles.length > 0) {
      lines.push("dirty_files:");
      for (const f of status.dirtyFiles) {
        lines.push(`  - ${f}`);
      }
    }
    if (status.baselineFiles.length > 0) {
      lines.push("baseline_files:");
      for (const f of status.baselineFiles) lines.push(`  - ${f}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [];
  lines.push(`branch  ${status.currentBranch}`);
  lines.push(`role    ${kindLabel(status.role)}`);
  lines.push(`base    ${status.baseBranch}`);
  if (status.card) lines.push(`card    ${status.card}`);
  lines.push(`dirty   ${status.dirty ? `yes (${status.dirtyFiles.length} files)` : "no"}`);
  lines.push(`ahead   ${status.ahead}`);
  lines.push(`behind  ${status.behind} (base)`);
  lines.push(`behind  ${status.behindUpstream} (upstream)`);
  lines.push(`upstream ${status.hasUpstream ? "configured" : "none"}`);
  if (status.nextAction) lines.push(`next    ${status.nextAction}`);
  if (status.promotionReady !== undefined) {
    lines.push(`promote ${status.promotionReady ? "ready" : "not ready"}`);
  }
  return lines.join("\n");
};

export const getProductionBranch = (config?: ProjectConfig): string =>
  config?.dev?.productionBranch ?? config?.dev?.defaultBase ?? "main";

export type StartBranchResult = {
  branchName: string;
  created: boolean;
  metadataRecorded: boolean;
  worktreePath?: string;
};

const recordBranchMetadata = (
  branchName: string,
  options: { kind: string; card?: string; base: string },
): Effect.Effect<boolean, ValidationError> =>
  Effect.gen(function* () {
    if (!options.card) return false;
    if (yield* readBranchMetadata(branchName)) return false;
    yield* writeBranchMetadata(branchName, {
      card: Number(options.card),
      kind: options.kind,
      base: options.base,
      createdAt: new Date().toISOString(),
    });
    return true;
  });

export const startBranch = (
  slug: string,
  options: {
    kind: string;
    card?: string;
    base?: string;
    allowDirty?: boolean;
    fromCurrent?: boolean;
    worktree?: boolean;
    /** Reuse the caller's already-loaded config instead of reading it again. */
    projectConfig?: ProjectConfig;
  },
): DevEffect<StartBranchResult> =>
  Effect.gen(function* () {
    // Optional, like every other dev command. A project without a .fizzyx.yaml still has
    // branches to start, and `getProductionBranch` and the prefix lookup below already
    // fall back on their own. Loading it strictly here was the single reason `dev start`
    // refused to run unconfigured while `status`, `ready`, `sync` and the rest worked.
    const projectConfig = options.projectConfig ?? (yield* loadConfigOptional());
    const status = yield* getStatus(projectConfig);

    if (status.dirty && !options.allowDirty) {
      return yield* new ValidationError({
        message: "Working tree is dirty. Commit, stash, or use --allow-dirty.",
      });
    }

    const productionBranch = getProductionBranch(projectConfig);
    const base = options.base ?? productionBranch;

    const devConfig = projectConfig?.dev;
    const prefix =
      devConfig?.branchPrefixes?.[options.kind as keyof typeof devConfig.branchPrefixes] ??
      options.kind;
    const cardPart = options.card ? `card-${options.card}-` : "";
    const branchName = `${prefix}/${cardPart}${slug}`;
    const exists = yield* branchExists(branchName);

    if (options.worktree) {
      return yield* startWorktree({
        branchName,
        base,
        exists,
        kind: options.kind,
        card: options.card,
        fromCurrent: options.fromCurrent,
      });
    }

    if (exists) {
      if (status.currentBranch !== branchName) yield* runGit(["checkout", branchName]);
      const metadataRecorded = yield* recordBranchMetadata(branchName, {
        kind: options.kind,
        card: options.card,
        base,
      });
      if (!status.dirty && !(yield* readBaseline(branchName))) yield* writeBaseline(branchName);
      return { branchName, created: false, metadataRecorded };
    }

    if (status.currentBranch !== base && !options.fromCurrent) {
      yield* runGit(["checkout", base]);
    }

    yield* runGit(["checkout", "-b", branchName]);

    let metadataRecorded = false;
    if (options.card) {
      const metadata: DevBranchMetadata = {
        card: Number(options.card),
        kind: options.kind,
        base,
        createdAt: new Date().toISOString(),
      };
      yield* writeBranchMetadata(branchName, metadata);
      metadataRecorded = true;
    }
    yield* writeBaseline(branchName);

    return { branchName, created: true, metadataRecorded };
  });

const startWorktree = (options: {
  branchName: string;
  base: string;
  exists: boolean;
  kind: string;
  card?: string;
  fromCurrent?: boolean;
}): Effect.Effect<StartBranchResult, ValidationError, ConfigRepository> =>
  Effect.gen(function* () {
    const { branchName, base, exists } = options;
    const worktreePath = yield* resolveWorktreePath(branchName);

    const worktrees = yield* listWorktrees();
    const existingForBranch = worktrees.find((w) => w.branch === branchName);
    if (existingForBranch) {
      return yield* new ValidationError({
        message: `Branch '${branchName}' is already checked out in a worktree at ${existingForBranch.path}. Work there, or remove it first.`,
      });
    }
    if (worktrees.some((w) => resolve(w.path) === resolve(worktreePath))) {
      return yield* new ValidationError({
        message: `A worktree already exists at ${worktreePath}. Remove it before starting again.`,
      });
    }

    if (exists) {
      yield* runGit(["worktree", "add", worktreePath, branchName]);
    } else {
      const from = options.fromCurrent ? "HEAD" : base;
      yield* runGit(["worktree", "add", "-b", branchName, worktreePath, from]);
    }

    const metadataRecorded = yield* recordBranchMetadata(branchName, {
      kind: options.kind,
      card: options.card,
      base,
    });
    // Baseline lives in the worktree's own git dir (git resolves fizzyx/* per-worktree),
    // so a later `fizzyx dev status` run from inside the worktree finds it.
    yield* writeBaseline(branchName, { cwd: worktreePath });

    return { branchName, created: !exists, metadataRecorded, worktreePath };
  });

export const isOnCompatibleBranch = (
  currentBranch: string,
  kind: string,
  slug: string,
  card?: string,
  config?: ProjectConfig,
): string | undefined => {
  const devConfig = config?.dev;
  if (!devConfig) return undefined;
  const prefix = devConfig.branchPrefixes?.[kind as keyof typeof devConfig.branchPrefixes] ?? kind;
  if (!currentBranch.startsWith(`${prefix}/`)) return undefined;
  const cardPart = card ? `card-${card}-` : "";
  const expected = `${prefix}/${cardPart}${slug}`;
  if (currentBranch !== expected) return undefined;
  return `Already on compatible branch '${currentBranch}'. No new branch needed.`;
};

/**
 * True while a rebase or merge is actually stopped part-way. `sync` used to print a
 * conflict-recovery script for every non-zero exit, so a plain refusal such as
 * "cannot rebase: You have unstaged changes" was answered with four steps that all fail —
 * there was no rebase to continue or abort.
 */
const isOperationInProgress = (
  operation: "rebase" | "merge",
): Effect.Effect<boolean, ValidationError> =>
  Effect.gen(function* () {
    const paths = operation === "rebase" ? ["rebase-merge", "rebase-apply"] : ["MERGE_HEAD"];
    for (const path of paths) {
      const resolved = yield* runGitNoThrow(["rev-parse", "--git-path", path]);
      if (resolved.exitCode === 0 && resolved.stdout && existsSync(resolved.stdout)) return true;
    }
    return false;
  });

const describeSyncFailure = (options: {
  operation: "rebase" | "merge";
  branch: string;
  result: { stdout: string; stderr: string };
  stashHint: string;
  steps: ReadonlyArray<string>;
  stashed: boolean;
}): Effect.Effect<string, ValidationError> =>
  Effect.gen(function* () {
    const { operation, branch, result } = options;
    const detail = result.stderr || result.stdout || `git ${operation} failed`;
    if (!(yield* isOperationInProgress(operation))) {
      const stashNote = options.stashed
        ? "\nYour changes were stashed as 'fizzyx-auto-stash'; run 'git stash pop' to restore them."
        : "\nIf the tree has uncommitted changes, run 'fizzyx dev sync --stash'.";
      return `${operation === "rebase" ? "Rebase" : "Merge"} failed on '${branch}' and no ${operation} is in progress:\n${detail}${stashNote}`;
    }
    const numbered = ["Resolve conflicts manually.", "git add <resolved-files>", ...options.steps]
      .map((step, index) => `  ${index + 1}. ${step}`)
      .join("\n");
    return `${operation === "rebase" ? "Rebase" : "Merge"} conflict on '${branch}':\n${detail}\nRecovery:\n${numbered}${options.stashHint}`;
  });

export const syncBranch = (
  stash?: boolean,
): Effect.Effect<string, ValidationError | ConfigError | FileError, ConfigRepository> =>
  Effect.gen(function* () {
    const status = yield* getStatus();

    // Baseline-accepted files are excluded from `dirty`, but git still refuses to rebase
    // over them, so a baseline-accepted tree could never be synced through the CLI at all.
    // They are stashable like anything else; only the refusal stays keyed on `dirty`, so
    // trees that used to sync without --stash still do.
    const hasUncommitted = status.dirty || status.baselineFiles.length > 0;
    const didStash = hasUncommitted && stash === true;
    if (hasUncommitted) {
      if (stash) {
        yield* runGit(["stash", "push", "-m", "fizzyx-auto-stash"]);
      } else if (status.dirty) {
        return yield* new ValidationError({
          message: "Working tree is dirty. Use --stash to auto-stash changes.",
        });
      }
    }

    yield* runGit(["fetch"]);

    const configRepo = yield* ConfigRepo;
    const projectConfig = yield* configRepo
      .loadProjectConfig()
      .pipe(Effect.catch(() => Effect.succeed(undefined as ProjectConfig | undefined)));
    const syncStrategy = projectConfig?.dev?.syncStrategy ?? "rebase";
    // `git fetch` above advances origin/<base>, never the local <base>. Rebasing onto the
    // local branch is what made `sync` a silent no-op against a stale base.
    const base = (yield* resolveBaseRef(projectConfig ?? undefined)).ref;

    const stashHint = didStash
      ? "\n  5. Run 'git stash pop' after resolving to restore your working changes."
      : "";

    if (syncStrategy === "rebase") {
      const result = yield* runGitNoThrow(["rebase", base]);
      if (result.exitCode !== 0) {
        return yield* new ValidationError({
          message: yield* describeSyncFailure({
            operation: "rebase",
            branch: status.currentBranch,
            result,
            stashHint,
            steps: ["git rebase --continue", "Or abort: git rebase --abort"],
            stashed: didStash,
          }),
        });
      }
    } else if (syncStrategy === "merge") {
      const result = yield* runGitNoThrow(["merge", base]);
      if (result.exitCode !== 0) {
        return yield* new ValidationError({
          message: yield* describeSyncFailure({
            operation: "merge",
            branch: status.currentBranch,
            result,
            stashHint,
            steps: ["git commit (merge will complete)", "Or abort: git merge --abort"],
            stashed: didStash,
          }),
        });
      }
    }

    if (didStash) {
      const stashList = yield* runGit(["stash", "list"]);
      if (stashList.includes("fizzyx-auto-stash")) {
        yield* runGit(["stash", "pop"]);
      }
    }

    return `Synced with ${base} using ${syncStrategy}`;
  });

export const checkpoint = (
  message?: string,
  all?: boolean,
  allowProtected?: boolean,
): Effect.Effect<string, ValidationError, ConfigRepository> =>
  Effect.gen(function* () {
    const projectConfig = yield* loadConfigOptional();
    const status = yield* getStatus(projectConfig);
    if (!status.dirty) {
      return "No changes to checkpoint.";
    }

    if (!allowProtected) {
      if (yield* isDetachedHead()) {
        return yield* new ValidationError({
          message:
            "HEAD is detached, so a checkpoint commit here would be reachable from no branch. Switch to a branch first, or pass --allow-protected to commit anyway.",
        });
      }
      if (status.role === "protected") {
        return yield* new ValidationError({
          message: `Refusing to checkpoint on protected branch '${status.currentBranch}'. Run 'fizzyx dev start <slug>' to move the work to its own branch, or pass --allow-protected to commit anyway.`,
        });
      }
    }

    if (all) {
      // The explicit "everything" escape: pre-existing user changes and untracked files
      // included. `--update` used to be the implementation, which silently dropped
      // untracked files while still reporting a successful checkpoint.
      yield* runGit(["add", "--all"]);
    } else {
      // Default: stage only what this task touched. `partitionWorktree` already separates
      // task-owned entries from the recorded baseline, and a pathspec add covers untracked
      // files too, so a checkpoint can never sweep up the user's pre-existing changes.
      const entries = yield* snapshotWorktree();
      const baseline = yield* readBaseline(status.currentBranch);
      const taskPaths = partitionWorktree(entries, baseline).blocking.map((entry) => entry.path);
      yield* runGit(["add", "--", ...taskPaths]);
    }

    const card = status.card;
    const msg = message ?? (card ? `wip(card-${card}): checkpoint` : "wip: checkpoint");

    yield* runGit(["commit", "-m", msg]);
    return msg;
  });

const findWipCommits = (): Effect.Effect<ReadonlyArray<string>, ValidationError> =>
  Effect.gen(function* () {
    const stdout = yield* runGit([
      "log",
      "--oneline",
      "--grep",
      WIP_COMMIT_GREP,
      "HEAD",
      "--not",
      "--remotes",
    ]);
    return stdout
      ? stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  });

/**
 * How a squash ended. The outcome is carried explicitly rather than sniffed back out of the
 * message: reading `message.startsWith("No")` reported a green `squash-wip` check for every
 * failure whose wording happened not to start with those two letters.
 */
type SquashOutcome =
  /** History was rewritten into a single commit. */
  | "squashed"
  /** There was nothing to do. Not a failure. */
  | "nothing-to-squash"
  /** Squashing was possible but would have destroyed something. Blocks readiness. */
  | "refused"
  /** The squash could not be carried out. Blocks readiness. */
  | "failed";

interface SquashResult {
  message: string;
  outcome: SquashOutcome;
}

/**
 * Commits between `mergeBase` and HEAD that are already reachable from a remote. Squashing
 * collapses everything in that range, so any published commit in it would need a force push
 * to recover — which the workflow forbids.
 */
const findPublishedCommits = (
  mergeBase: string,
): Effect.Effect<ReadonlyArray<string>, ValidationError> =>
  Effect.gen(function* () {
    const toLines = (value: string): ReadonlyArray<string> =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const collapsed = toLines(yield* runGit(["rev-list", `${mergeBase}..HEAD`]));
    const unpublished = new Set(
      toLines(yield* runGit(["rev-list", `${mergeBase}..HEAD`, "--not", "--remotes"])),
    );
    return collapsed.filter((sha) => !unpublished.has(sha));
  });

const squashWipCommits = (base: string): Effect.Effect<SquashResult, ValidationError> =>
  Effect.gen(function* () {
    const wipCommits = yield* findWipCommits();
    if (wipCommits.length === 0) {
      return { message: "No WIP commits to squash.", outcome: "nothing-to-squash" };
    }

    const mergeBase = yield* runGit(["merge-base", "HEAD", base]).pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    if (!mergeBase) {
      return {
        message: `Cannot determine the merge base between HEAD and '${base}', so there is no commit to squash back to. The branch may not share history with the base, or '${base}' may not exist here.`,
        outcome: "failed",
      };
    }

    const published = yield* findPublishedCommits(mergeBase);
    if (published.length > 0) {
      const subject = yield* runGit(["log", "-1", "--format=%s", published[0] as string]).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      return {
        message: `Refusing to squash: commit ${published[0]}${
          subject ? ` (${subject})` : ""
        } is already published to a remote, and squashing back to ${mergeBase.slice(
          0,
          12,
        )} would rewrite it. Recovering from that needs a force push, which this workflow forbids. Squash only unpublished commits, or land the published ones as they are.`,
        outcome: "refused",
      };
    }

    // `reset --soft` followed by `commit` destroys the branch's commits before recreating
    // them. If the range has no net diff against the merge base, the commit half fails with
    // nothing to commit and the branch is simply left at the merge base — every commit gone,
    // while `ready` reported success. Check for that before touching anything.
    const netDiff = yield* runGitNoThrow(["diff", "--quiet", mergeBase, "HEAD"]);
    if (netDiff.exitCode === 0) {
      return {
        message: `Refusing to squash: the ${wipCommits.length} WIP commit(s) leave no net change against ${mergeBase.slice(
          0,
          12,
        )}, so squashing them would collapse the branch to the merge base and commit nothing. Drop the branch, or commit the work you meant to keep.`,
        outcome: "refused",
      };
    }

    const branchName = yield* getCurrentBranch();
    const kind = branchName.startsWith("fix/") ? "fix" : "feat";
    const scope = branchName.includes("card-") ? (branchName.match(/card-\d+/)?.[0] ?? "") : "";

    const originalHead = yield* runGit(["rev-parse", "HEAD"]);
    yield* runGit(["reset", "--soft", mergeBase]);
    const message = scope
      ? `${kind}(${scope}): squash checkpoint commits`
      : `${kind}: squash checkpoint commits`;
    // The reset already happened. If the commit fails for any reason, put HEAD back rather
    // than leaving the branch sitting at the merge base with its commits detached.
    const committed = yield* runGitNoThrow(["commit", "-m", message]);
    if (committed.exitCode !== 0) {
      yield* runGitNoThrow(["reset", "--soft", originalHead]);
      return {
        message: `Squash failed and the branch was restored to ${originalHead.slice(0, 12)}: ${
          committed.stderr || committed.stdout || "git commit exited non-zero"
        }`,
        outcome: "failed",
      };
    }

    return {
      message: `Squashed ${wipCommits.length} WIP commit(s) into one: ${message}`,
      outcome: "squashed",
    };
  });

export const ready = (full?: boolean, squash?: boolean): DevEffect<DevReadyResult> =>
  Effect.gen(function* () {
    const configRepo = yield* ConfigRepo;
    const projectConfig = yield* configRepo
      .loadProjectConfig()
      .pipe(Effect.catch(() => Effect.succeed(undefined as ProjectConfig | undefined)));
    const blockedReasons: string[] = [];
    const checksRun: CheckResult[] = [];

    // Squash before reading status: it rewrites history, and every status-derived decision
    // below (and the readiness receipt) has to describe the branch as it ends up, not as it
    // was when the command started.
    if (squash) {
      const base =
        projectConfig?.dev?.defaultBase ?? projectConfig?.dev?.productionBranch ?? "main";
      const squashResult: SquashResult = yield* squashWipCommits(base).pipe(
        Effect.catch((cause) =>
          Effect.succeed({
            message: `Squash failed: ${cause.message}`,
            outcome: "failed" as const,
          }),
        ),
      );
      checksRun.push({
        name: "squash-wip",
        passed: squashResult.outcome === "squashed" || squashResult.outcome === "nothing-to-squash",
        output: squashResult.message,
      });
      // A refusal and a failure both mean the branch is not in the state `--squash` promised,
      // so neither may pass silently through to a readiness verdict.
      if (squashResult.outcome === "refused" || squashResult.outcome === "failed") {
        blockedReasons.push(squashResult.message);
      }
    }

    const status = yield* getStatus(projectConfig ?? undefined);

    if (status.role === "protected") {
      blockedReasons.push("Current branch is protected");
    }

    if (status.dirty) {
      blockedReasons.push("Working tree has uncommitted changes");
    }

    if (status.behind > 0) {
      blockedReasons.push(
        `Branch is behind base by ${status.behind} commit(s). Run 'fizzyx dev sync'.`,
      );
    }

    const wipCommits = yield* findWipCommits().pipe(Effect.catch(() => Effect.succeed([])));
    const allowWip = projectConfig?.dev?.commit?.allowWipOnReady;
    if (wipCommits.length > 0 && !allowWip) {
      blockedReasons.push(
        `Branch has ${wipCommits.length} WIP commit(s). Use --squash or commit properly.`,
      );
    }

    const checkCommands = full
      ? (projectConfig?.dev?.checks?.full ?? projectConfig?.dev?.checks?.ready ?? [])
      : (projectConfig?.dev?.checks?.ready ?? []);

    for (const cmd of checkCommands) {
      const result = yield* runShell(cmd);
      checksRun.push({
        name: cmd,
        passed: result.exitCode === 0,
        output:
          result.exitCode === 0
            ? result.stdout
            : truncateCheckOutput([result.stdout, result.stderr].filter(Boolean).join("\n")),
      });
      if (result.exitCode !== 0) {
        blockedReasons.push(`Check failed: ${cmd}`);
      }
    }

    const suggestedPromotion =
      !blockedReasons.length && !status.dirty && status.role !== "protected"
        ? `fizzyx dev promote ${status.currentBranch} --to <target> --dry-run`
        : undefined;

    if (blockedReasons.length === 0) {
      const [head, base] = yield* Effect.all([
        runGit(["rev-parse", "HEAD"]),
        runGit(["rev-parse", status.baseBranch]),
      ]);
      yield* writeReadyReceipt({
        version: 1,
        branch: status.currentBranch,
        head,
        base,
        mode: full ? "full" : "ready",
        checks: checkCommands,
        createdAt: new Date().toISOString(),
      });
    } else {
      yield* removeReadyReceipt(status.currentBranch);
    }

    return {
      ready: blockedReasons.length === 0,
      blockedReasons,
      checksRun,
      suggestedPromotion,
    };
  });

export const formatReady = (result: DevReadyResult, agent: boolean): string => {
  if (agent) {
    const lines: string[] = [
      `ready: ${result.ready ? "yes" : "no"}`,
      `blocked: ${result.blockedReasons.length}`,
    ];
    for (const reason of result.blockedReasons) {
      lines.push(`  - ${reason}`);
    }
    if (result.blockedReasons.some((reason) => reason.includes("uncommitted changes"))) {
      lines.push(
        `next_action: Stage and commit/checkpoint only changes made in this task; do not commit pre-existing user changes without explicit approval.`,
      );
    }
    for (const check of result.checksRun) {
      lines.push(`check: ${check.name} ${check.passed ? "passed" : "failed"}`);
      if (!check.passed && check.output) {
        lines.push("check_output:");
        for (const line of check.output.split("\n")) lines.push(`  ${line}`);
      }
    }
    if (result.suggestedPromotion) {
      lines.push(`suggested_promotion: ${result.suggestedPromotion}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [];
  if (result.ready) {
    lines.push("Branch is ready for promotion.");
  } else {
    lines.push("Branch is NOT ready:");
    for (const reason of result.blockedReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  for (const check of result.checksRun) {
    const icon = check.passed ? "✓" : "✗";
    lines.push(`  ${icon} ${check.name}`);
    if (check.output) {
      lines.push(`    ${check.output}`);
    }
  }
  if (result.suggestedPromotion) {
    lines.push(`promote ${result.suggestedPromotion}`);
  }
  return lines.join("\n");
};

export const isIndependentlyPromotable = (role: BranchRole): boolean =>
  role === "feature" || role === "maintenance";

const getBranchNameKind = (branch: string, config?: DevConfig): string | undefined => {
  const prefixes = config?.branchPrefixes ?? {
    feature: "feature",
    fix: "fix",
    hotfix: "hotfix",
    ops: "ops",
    chore: "chore",
    docs: "docs",
  };
  for (const [, prefix] of Object.entries(prefixes)) {
    if (branch.startsWith(`${prefix}/`)) return prefix;
  }
  return undefined;
};

const getChangedFileList = (
  sourceBranch: string,
  targetBranch: string,
): Effect.Effect<ReadonlyArray<string>, ValidationError> =>
  Effect.gen(function* () {
    const stdout = yield* runGit([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${targetBranch}...${sourceBranch}`,
    ]);
    return stdout
      ? stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  });

export const checkPromotion = (
  sourceBranch: string,
  targetBranch: string,
  config?: ProjectConfig,
): Effect.Effect<ReadonlyArray<PromotionCheck>, ValidationError> =>
  Effect.gen(function* () {
    const checks: PromotionCheck[] = [];
    const devConfig = config?.dev;

    const sourceRole = classifyBranch(sourceBranch, devConfig);
    const targetRole = classifyBranch(targetBranch, devConfig);

    const sourceExists = yield* branchExists(sourceBranch);
    checks.push({
      passed: sourceExists,
      reason: `Source branch '${sourceBranch}' ${sourceExists ? "exists" : "does not exist"}`,
    });

    const targetExists = yield* branchExists(targetBranch);
    checks.push({
      passed: targetExists,
      reason: `Target branch '${targetBranch}' ${targetExists ? "exists" : "does not exist"}`,
    });

    checks.push({
      passed: isIndependentlyPromotable(sourceRole),
      reason: `Source role '${kindLabel(sourceRole)}' is ${isIndependentlyPromotable(sourceRole) ? "independently promotable" : "not independently promotable"}`,
    });

    checks.push({
      passed: targetRole === "protected" || targetRole === "environment",
      reason: `Target role '${kindLabel(targetRole)}' is ${targetRole === "protected" || targetRole === "environment" ? "a valid target" : "not a valid deployment target"}`,
    });

    const isEnvToProd = sourceRole === "environment" && targetRole === "protected";
    const blockEnvToProd = devConfig?.promotion?.blockEnvironmentToProduction ?? true;
    if (isEnvToProd && blockEnvToProd) {
      checks.push({
        passed: false,
        reason:
          "Promoting environment branches to production is blocked. Promote from a feature or maintenance branch.",
      });
    }

    const wipCommits = yield* findBranchWipCommits(sourceBranch).pipe(
      Effect.catch(() => Effect.succeed([])),
    );
    checks.push({
      passed: wipCommits.length === 0,
      reason:
        wipCommits.length === 0
          ? "Source branch has no WIP commits"
          : `Source branch has ${wipCommits.length} WIP commit(s). Run 'fizzyx dev ready --squash' first.`,
    });

    const requireReady = devConfig?.promotion?.requireReadyForProduction ?? false;
    if (requireReady && targetRole === "protected") {
      const [receipt, sourceHead, targetHead] = yield* Effect.all([
        readReadyReceipt(sourceBranch),
        runGit(["rev-parse", sourceBranch]),
        runGit(["rev-parse", targetBranch]),
      ]);
      const expectedChecks = devConfig?.checks?.full ?? devConfig?.checks?.ready ?? [];
      const receiptValid =
        receipt?.branch === sourceBranch &&
        receipt.head === sourceHead &&
        receipt.base === targetHead &&
        receipt.mode === "full" &&
        JSON.stringify(receipt.checks) === JSON.stringify(expectedChecks);
      checks.push({
        passed: receiptValid,
        reason: receiptValid
          ? `Source HEAD ${sourceHead.slice(0, 12)} has a valid full readiness receipt`
          : "Source HEAD has no valid full readiness receipt. Run 'fizzyx dev ready --full' first.",
      });
    }

    // Only `ops` branches have a file-scope rule; for every other kind nothing was ever
    // evaluated, so report no verdict rather than a green check nobody computed.
    const sourceKind = getBranchNameKind(sourceBranch, devConfig);
    if (sourceKind && hasFileScopeRule(sourceKind)) {
      const changedFiles = yield* getChangedFileList(sourceBranch, targetBranch).pipe(
        Effect.catch(() => Effect.succeed([])),
      );
      const unrelated = changedFiles.filter((f) => isUnrelatedFile(f, sourceKind));
      checks.push({
        passed: unrelated.length === 0,
        reason:
          unrelated.length === 0
            ? `All changed files are within the '${sourceKind}' branch scope`
            : `${unrelated.length} unrelated file(s) changed on this branch: ${unrelated.slice(0, 5).join(", ")}`,
      });
    }

    return checks;
  });

export const acceptBaseline = (): Effect.Effect<DevBaseline, ValidationError> =>
  Effect.gen(function* () {
    const branch = yield* getCurrentBranch();
    return yield* writeBaseline(branch);
  });

export const showBaseline = () =>
  Effect.gen(function* () {
    const branch = yield* getCurrentBranch();
    return { branch, baseline: yield* readBaseline(branch), current: yield* snapshotWorktree() };
  });

/**
 * Branch kinds that have a meaningful file-scope rule. Only `ops` does: a feature or fix
 * branch may legitimately touch any file, so there is nothing generic to assert about it.
 */
const hasFileScopeRule = (branchKind: string): boolean => branchKind === "ops";

const isUnrelatedFile = (filePath: string, branchKind: string): boolean => {
  if (branchKind === "docs") return false;
  if (branchKind === "chore") return false;
  if (branchKind === "ops")
    return !(
      filePath.startsWith("deploy/") ||
      filePath.startsWith("infra/") ||
      filePath.startsWith("ops/") ||
      filePath.startsWith(".github/workflows/")
    );
  if (branchKind === "fix" || branchKind === "hotfix") return false;
  return false;
};

const findBranchWipCommits = (
  branch: string,
): Effect.Effect<ReadonlyArray<string>, ValidationError> =>
  Effect.gen(function* () {
    const stdout = yield* runGit([
      "log",
      "--oneline",
      "--grep",
      WIP_COMMIT_GREP,
      branch,
      "--not",
      "--remotes",
    ]);
    return stdout
      ? stdout
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [];
  });

const branchExists = (name: string): Effect.Effect<boolean, ValidationError> =>
  Effect.gen(function* () {
    const local = yield* runGit(["branch", "--list", name]).pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    if (local) return true;
    const remote = yield* runGit(["branch", "-r", "--list", `origin/${name}`]).pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    return !!remote;
  });

export const formatPromotionChecks = (
  checks: ReadonlyArray<PromotionCheck>,
  agent: boolean,
  sourceBranch?: string,
  targetBranch?: string,
): string => {
  if (agent) {
    const lines: string[] = [];
    if (sourceBranch && targetBranch) {
      lines.push(`source_branch: ${sourceBranch}`);
      lines.push(`target_branch: ${targetBranch}`);
    }
    lines.push(`checks: ${checks.filter((c) => c.passed).length}/${checks.length} passed`);
    for (const check of checks) {
      lines.push(`check: ${check.passed ? "pass" : "fail"} ${check.reason}`);
    }
    return lines.join("\n");
  }

  const lines: string[] = [];
  for (const check of checks) {
    const icon = check.passed ? "✓" : "✗";
    lines.push(`  ${icon} ${check.reason}`);
  }
  return lines.join("\n");
};

export const getPromotionCommands = (
  sourceBranch: string,
  targetBranch: string,
  config?: ProjectConfig,
): ReadonlyArray<GitCommand> => {
  const strategy = config?.dev?.promotion?.strategy ?? "merge";
  const baseCommand: GitCommand[] = [
    { command: `git fetch`, description: "Fetch latest remote refs" },
    { command: `git checkout ${targetBranch}`, description: `Switch to target branch` },
    { command: `git pull --ff-only`, description: "Fast-forward target branch" },
  ];

  switch (strategy) {
    case "merge":
      return [
        ...baseCommand,
        { command: `git merge ${sourceBranch}`, description: `Merge source into target` },
      ];
    case "squash":
      return [
        ...baseCommand,
        {
          command: `git merge --squash ${sourceBranch}`,
          description: "Squash-merge source into target",
        },
        {
          command: `git commit -m "feat: merge ${sourceBranch}"`,
          description: "Commit squashed changes",
        },
      ];
    case "pr":
      return [
        { command: `git push -u origin ${sourceBranch}`, description: "Push source for PR" },
        {
          command: `gh pr create --base ${targetBranch} --head ${sourceBranch}`,
          description: "Create PR to target",
        },
      ];
  }
};

export interface PromotionStepResult {
  command: string;
  description: string;
  exitCode: number;
  output: string;
}

export const applyPromotion = (
  commands: ReadonlyArray<GitCommand>,
): Effect.Effect<ReadonlyArray<PromotionStepResult>, ValidationError> =>
  Effect.gen(function* () {
    const results: PromotionStepResult[] = [];
    for (const cmd of commands) {
      const result = yield* runShell(cmd.command);
      results.push({
        command: cmd.command,
        description: cmd.description,
        exitCode: result.exitCode,
        output: result.stdout,
      });
      if (result.exitCode !== 0) {
        return results;
      }
    }
    return results;
  });

const getMergedBranches = (
  base: string,
  config?: ProjectConfig,
): Effect.Effect<ReadonlyArray<string>, ValidationError> =>
  Effect.gen(function* () {
    const stdout = yield* runGit(["branch", "--merged", base, "--format", "%(refname:short)"]);
    if (!stdout) return [];
    const branches = stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    return branches.filter((branch) => {
      if (branch === base || branch.startsWith("release/")) return false;
      const role = classifyBranch(branch, config?.dev);
      return role === "feature" || role === "maintenance";
    });
  });

export const cleanup = (options?: {
  abandon?: boolean;
  confirmDelete?: boolean;
}): Effect.Effect<string, ValidationError | ConfigError | FileError, ConfigRepository> =>
  Effect.gen(function* () {
    const status = yield* getStatus();
    const configRepo = yield* ConfigRepo;
    const projectConfig = yield* configRepo
      .loadProjectConfig()
      .pipe(Effect.catch(() => Effect.succeed(undefined as ProjectConfig | undefined)));
    const productionBranch = getProductionBranch(projectConfig ?? undefined);
    const onProtected = status.role === "protected";

    const currentBranch = status.currentBranch;
    const mergedBranches = yield* getMergedBranches(productionBranch, projectConfig ?? undefined);
    const worktrees = yield* listWorktrees().pipe(Effect.catch(() => Effect.succeed([])));
    // The first entry is the main working tree; only linked worktrees block `git branch -d`.
    const linkedWorktrees = worktrees.slice(1);
    const worktreeByBranch = new Map(
      linkedWorktrees.filter((w) => w.branch).map((w) => [w.branch as string, w.path] as const),
    );
    const currentWorktreePath = resolve(process.cwd());

    if (!options?.confirmDelete) {
      const pending =
        mergedBranches.length > 0
          ? ` ${mergedBranches
              .map((b) =>
                worktreeByBranch.has(b) ? `${b} (worktree: ${worktreeByBranch.get(b)})` : b,
              )
              .join(", ")}`
          : " none";
      return `Cleanup preview: ${mergedBranches.length} merged branch(es) pending deletion:${pending}. No branches deleted. Add --confirm-delete to delete local branches.`;
    }

    if (!onProtected) {
      // `git checkout` carries uncommitted changes across, so cleaning up from a dirty tree
      // would deposit the user's work on the protected branch — and if it conflicted there
      // the checkout would throw part-way through, leaving cleanup half-done. Refusing keeps
      // the command all-or-nothing; baseline-accepted files count too, because checkout
      // carries them just the same.
      if (status.dirty || status.baselineFiles.length > 0) {
        return yield* new ValidationError({
          message: `Working tree has uncommitted changes. Cleanup would switch to '${productionBranch}' and carry them onto it. Commit or stash them first, then re-run cleanup.`,
        });
      }
      yield* runGit(["checkout", productionBranch]);
    }
    let deleted = 0;
    const skipped: string[] = [];
    for (const branch of mergedBranches) {
      const worktreePath = worktreeByBranch.get(branch);
      if (worktreePath) {
        if (resolve(worktreePath) === currentWorktreePath) {
          skipped.push(`${branch} (current worktree)`);
          continue;
        }
        const removed = yield* runGitNoThrow(["worktree", "remove", worktreePath]);
        if (removed.exitCode !== 0) {
          skipped.push(`${branch} (worktree not removable: ${worktreePath})`);
          continue;
        }
      }
      const result = yield* runGit(["branch", "-d", branch]).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      if (result) {
        deleted++;
        yield* removeBranchState(branch).pipe(Effect.catch(() => Effect.succeed(undefined)));
      }
    }
    if (worktrees.length > 0) {
      yield* runGit(["worktree", "prune"]).pipe(Effect.catch(() => Effect.succeed("")));
    }

    if (
      options?.abandon &&
      !onProtected &&
      currentBranch !== productionBranch &&
      !mergedBranches.includes(currentBranch)
    ) {
      const result = yield* runGit(["branch", "-D", currentBranch]).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      if (result) {
        deleted++;
        yield* removeBranchState(currentBranch).pipe(Effect.catch(() => Effect.succeed(undefined)));
      }
    }

    yield* runGit(["remote", "prune", "origin"]).pipe(Effect.catch(() => Effect.succeed("")));

    const skippedNote = skipped.length > 0 ? ` Skipped: ${skipped.join(", ")}.` : "";
    const nowOn = onProtected ? currentBranch : productionBranch;
    return `Deleted ${deleted} local branch(es). Now on '${nowOn}'.${skippedNote}`;
  });

export const doctor = (config?: ProjectConfig): Effect.Effect<DoctorReport, ValidationError> =>
  Effect.gen(function* () {
    const devConfig = config?.dev;
    const staleAfterDays = devConfig?.staleAfterDays ?? 7;
    const productionBranch = getProductionBranch(config);

    const allBranches = yield* runGit(["branch", "--format", "%(refname:short)"]).pipe(
      Effect.catch(() => Effect.succeed("")),
    );
    const branchList = allBranches
      ? allBranches
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
      : [];

    const currentBranch = yield* getCurrentBranch().pipe(Effect.catch(() => Effect.succeed("")));

    const staleBranches: DoctorBranchInfo[] = [];
    const noUpstreamBranches: DoctorBranchInfo[] = [];
    const mergedBranches: DoctorBranchInfo[] = [];
    const environmentAhead: DoctorBranchInfo[] = [];
    const wipOnReady: DoctorBranchInfo[] = [];
    const protectedDirty: DoctorBranchInfo[] = [];
    const featureOnEnvBase: DoctorBranchInfo[] = [];
    const now = Date.now();

    const envBranchNames = devConfig?.environmentBranches
      ? Object.keys(devConfig.environmentBranches)
      : [];

    for (const branch of branchList) {
      const role = classifyBranch(branch, devConfig);

      const authorDate = yield* runGit(["log", "-1", "--format=%at", branch]).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      if (authorDate) {
        const ageDays = (now - Number(authorDate) * 1000) / (1000 * 60 * 60 * 24);
        if (ageDays > staleAfterDays && role === "feature") {
          staleBranches.push({ name: branch, detail: `${Math.round(ageDays)} days old` });
        }
      }

      const hasUpstream = yield* runGit([
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        `${branch}@{u}`,
      ]).pipe(Effect.catch(() => Effect.succeed("")));
      if (!hasUpstream) {
        noUpstreamBranches.push({ name: branch, detail: "No upstream tracking" });
      }

      if (role === "environment") {
        const behindProduction = yield* runGit([
          "rev-list",
          "--count",
          `${productionBranch}..${branch}`,
        ]).pipe(Effect.catch(() => Effect.succeed("0")));
        const ahead = Number(behindProduction);
        if (ahead > 5) {
          environmentAhead.push({
            name: branch,
            detail: `${ahead} commits ahead of ${productionBranch}`,
          });
        }
      }

      if (role === "protected" && branch === currentBranch) {
        // `git status` only ever describes the worktree it runs in, and the branch name was
        // being consumed as a pathspec — which matches nothing, so this never fired. It can
        // only be answered for the branch actually checked out here.
        const dirty = yield* runGit(["status", "--porcelain"]).pipe(
          Effect.catch(() => Effect.succeed("")),
        );
        if (dirty) {
          protectedDirty.push({
            name: branch,
            detail: `${dirty.split("\n").length} dirty file(s) in the current worktree`,
          });
        }
      }

      if (role === "feature" || role === "maintenance") {
        for (const envBranch of envBranchNames) {
          // `merge-base --is-ancestor` answers through its exit code and prints nothing, so
          // the old truthiness test on stdout was never satisfied.
          const basedOnEnv = yield* runGitNoThrow([
            "merge-base",
            "--is-ancestor",
            envBranch,
            branch,
          ]);
          if (basedOnEnv.exitCode !== 0) continue;
          // An environment branch production already contains is an ancestor of everything,
          // so only report one that actually carries commits production does not have.
          const envMergedIntoProduction = yield* runGitNoThrow([
            "merge-base",
            "--is-ancestor",
            envBranch,
            productionBranch,
          ]);
          if (envMergedIntoProduction.exitCode === 0) continue;
          featureOnEnvBase.push({
            name: branch,
            detail: `Based on environment branch '${envBranch}' instead of '${productionBranch}'`,
          });
        }
      }

      const wipStdout = yield* runGit([
        "log",
        "--oneline",
        "--grep",
        WIP_COMMIT_GREP,
        branch,
        "--not",
        "--remotes",
      ]).pipe(Effect.catch(() => Effect.succeed("")));
      if (wipStdout) {
        wipOnReady.push({
          name: branch,
          detail: `${wipStdout.split("\n").length} WIP commit(s)`,
        });
      }
    }

    // An unborn HEAD (or a production branch that does not exist locally) makes
    // `git branch --merged` fail outright; report nothing merged rather than dying.
    const mergedList = yield* getMergedBranches(productionBranch, config).pipe(
      Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)),
    );
    const mergedSet = new Set(mergedList);
    for (const b of mergedList) {
      if (branchList.includes(b)) {
        mergedBranches.push({ name: b, detail: `Merged into ${productionBranch}` });
      }
    }

    const worktrees: DoctorBranchInfo[] = [];
    const linkedWorktrees = (yield* listWorktrees().pipe(
      Effect.catch(() => Effect.succeed([])),
    )).slice(1);
    for (const wt of linkedWorktrees) {
      const branch = wt.branch ?? "(detached)";
      const merged = wt.branch ? mergedSet.has(wt.branch) : false;
      worktrees.push({
        name: branch,
        detail: merged
          ? `merged — run 'fizzyx dev cleanup --confirm-delete' (${wt.path})`
          : `active (${wt.path})`,
      });
    }

    return {
      staleBranches,
      noUpstreamBranches,
      mergedBranches,
      environmentAhead,
      wipOnReady,
      protectedDirty,
      featureOnEnvBase,
      worktrees,
    };
  });

export const formatDoctor = (report: DoctorReport, agent = false): string => {
  if (agent) return formatDoctorAgent(report);
  const lines: string[] = [];
  const addSection = (title: string, items: ReadonlyArray<DoctorBranchInfo>) => {
    lines.push(`${title}:`);
    if (items.length === 0) {
      lines.push("  (none)");
    } else {
      for (const item of items) {
        lines.push(`  ${item.name}  ${item.detail}`);
      }
    }
    lines.push("");
  };

  addSection("Stale branches (no activity > threshold)", report.staleBranches);
  addSection("Branches without upstream tracking", report.noUpstreamBranches);
  addSection("Merged branches (pending human-confirmed deletion)", report.mergedBranches);
  addSection("Environment branches ahead of production", report.environmentAhead);
  addSection(
    "Feature branches based on environment branches (should use production)",
    report.featureOnEnvBase,
  );
  addSection("WIP commits on feature branches", report.wipOnReady);
  addSection("Protected branch dirty state", report.protectedDirty);
  addSection("Linked worktrees", report.worktrees);

  return lines.join("\n").trim();
};

const formatDoctorAgent = (report: DoctorReport): string => {
  const sections: ReadonlyArray<readonly [string, ReadonlyArray<DoctorBranchInfo>]> = [
    ["stale_branches", report.staleBranches],
    ["no_upstream", report.noUpstreamBranches],
    ["merged", report.mergedBranches],
    ["environment_ahead", report.environmentAhead],
    ["feature_on_env_base", report.featureOnEnvBase],
    ["wip_commits", report.wipOnReady],
    ["protected_dirty", report.protectedDirty],
    ["worktrees", report.worktrees],
  ];
  const lines: string[] = [];
  for (const [key, items] of sections) {
    lines.push(`${key}: ${items.length}`);
    for (const item of items) lines.push(`  - ${item.name}: ${item.detail}`);
  }
  return lines.join("\n");
};
