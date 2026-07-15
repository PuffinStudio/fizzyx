import { ConfigError, FileError } from "../domain/errors";
import type {
	Credentials,
	DevBranchMetadata,
	DevBranchPrefixConfig,
	DevChecksConfig,
	DevCommitConfig,
	DevConfig,
	DevEnvironmentBranchConfig,
	DevPromotionConfig,
	FlowConfig,
	FlowTagConfig,
	OssConfig,
	OssEnvironmentConfig,
	OssSyncConfig,
	ProjectInstalledSkillConfig,
	ProjectConfig,
	ProjectSkillsConfig,
	ProjectSkillSourceConfig,
} from "../domain/models";
import type {
	OpenApiAdminProjectConfig,
	OpenApiGenConfig,
	OpenApiProjectConfig,
	ParsedAdminAuthConfig,
} from "../domain/openapi-models";
import type { OssSetupInput, SetupProjectConfigInput } from "../ports/config-repository";

export const DEFAULT_ACCOUNT = "1";
export const DEFAULT_API_URL = "https://fizzy.puffin.studio";
const DEFAULT_WIP_LIMIT = 5;
const DEFAULT_CACHE_TTL_SECONDS = 900;

export const parseProjectConfig = (
	text: string,
	configPath: string,
	rootDir: string,
): ProjectConfig => {
	const raw = parseYaml(text);
	const account = stringValue(raw.account) || DEFAULT_ACCOUNT;
	const apiUrl = stringValue(raw.api_url) || DEFAULT_API_URL;
	const board = stringValue(raw.board) || undefined;
	const dev = parseDevConfig(raw.dev);
	const flow = parseFlowConfig(raw.flow);
	const oss = parseOssConfig(raw.oss);
	const openapi = parseOpenapiConfig(raw.openapi);
	const skills = parseProjectSkillsConfig(raw.skills);
	if (!board) {
		return {
			apiUrl,
			account,
			board: undefined,
			dev,
			flow,
			oss,
			openapi,
			skills,
			configPath,
			rootDir,
		};
	}

	return {
		apiUrl,
		account,
		board,
		dev,
		flow,
		oss,
		openapi,
		skills,
		configPath,
		rootDir,
	};
};

export const renderProjectConfig = (input: SetupProjectConfigInput, existingText = ""): string => {
	const existing = parseYaml(existingText);
	const existingFlow = objectValue(existing.flow);
	const existingDev = objectValue(existing.dev);

	const flow: YamlObject = {
		columns: {
			todo: input.todoColumn || stringValue(objectValue(existingFlow.columns).todo) || "",
			in_progress:
				input.inProgressColumn || stringValue(objectValue(existingFlow.columns).in_progress) || "",
		},
		users: parseUsersInput(input.users || {}),
		wip_limit: numberValue(existingFlow.wip_limit) || DEFAULT_WIP_LIMIT,
		cache_ttl: numberValue(existingFlow.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
	};
	const existingFlowTags = objectValue(existingFlow.tags);
	if (Object.keys(existingFlowTags).length > 0) {
		flow.tags = existingFlowTags;
	}

	const ordered: YamlObject = {};

	ordered.api_url = input.apiUrl || DEFAULT_API_URL;
	ordered.account = input.account || DEFAULT_ACCOUNT;
	ordered.board = input.board || "";

	for (const key of Object.keys(existing)) {
		if (key !== "api_url" && key !== "account" && key !== "board" && key !== "flow") {
			ordered[key] = existing[key] as YamlValue;
		}
	}

	ordered.flow = flow;

	if (input.dev) {
		const renderedDev = renderDevConfig(input.dev);
		if (Object.keys(renderedDev).length > 0 || Object.keys(existingDev).length > 0) {
			ordered.dev = {
				...existingDev,
				...renderedDev,
			};
		}
	} else if (Object.keys(existingDev).length > 0) {
		ordered.dev = existingDev;
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

const renderDevConfig = (dev: DevConfig): YamlObject => {
	const result: YamlObject = {};

	if (dev.productionBranch) {
		result.production_branch = dev.productionBranch;
	}

	if (dev.defaultBase) {
		result.default_base = dev.defaultBase;
	}

	if (dev.syncStrategy) {
		result.sync_strategy = dev.syncStrategy;
	}

	if (dev.protectedBranches) {
		result.protected_branches = dev.protectedBranches;
	}

	if (dev.environmentBranches) {
		const environmentBranches = renderDevEnvironmentBranches(dev.environmentBranches);
		if (Object.keys(environmentBranches).length > 0) {
			result.environment_branches = environmentBranches;
		}
	}

	if (dev.branchPrefixes) {
		const branchPrefixes = renderDevBranchPrefixes(dev.branchPrefixes);
		if (Object.keys(branchPrefixes).length > 0) {
			result.branch_prefixes = branchPrefixes;
		}
	}

	if (dev.checks) {
		const checks = renderDevChecksConfig(dev.checks);
		if (Object.keys(checks).length > 0) {
			result.checks = checks;
		}
	}

	if (dev.promotion) {
		result.promotion = renderDevPromotionConfig(dev.promotion);
	}

	if (dev.staleAfterDays !== undefined) {
		result.stale_after_days = dev.staleAfterDays;
	}

	if (dev.commit) {
		const commit = renderDevCommitConfig(dev.commit);
		if (Object.keys(commit).length > 0) {
			result.commit = commit;
		}
	}

	return result;
};

const renderDevEnvironmentBranches = (
	branches: Record<string, DevEnvironmentBranchConfig>,
): YamlObject => {
	const result: YamlObject = {};

	for (const [name, branch] of Object.entries(branches)) {
		const entry: YamlObject = {};
		if (branch.deploysTo) {
			entry.deploys_to = branch.deploysTo;
		}
		if (branch.aggregate) {
			entry.aggregate = true;
		}

		if (Object.keys(entry).length > 0) {
			result[name] = entry;
		}
	}

	return result;
};

const renderDevBranchPrefixes = (branchPrefixes: Partial<DevBranchPrefixConfig>): YamlObject => {
	const result: YamlObject = {};

	if (branchPrefixes.feature) result.feature = branchPrefixes.feature;
	if (branchPrefixes.fix) result.fix = branchPrefixes.fix;
	if (branchPrefixes.hotfix) result.hotfix = branchPrefixes.hotfix;
	if (branchPrefixes.ops) result.ops = branchPrefixes.ops;
	if (branchPrefixes.chore) result.chore = branchPrefixes.chore;
	if (branchPrefixes.docs) result.docs = branchPrefixes.docs;
	if (branchPrefixes.maintenance) result.maintenance = branchPrefixes.maintenance;

	return result;
};

const renderDevChecksConfig = (checks: DevChecksConfig): YamlObject => {
	const result: YamlObject = {};
	if (checks.ready) result.ready = checks.ready;
	if (checks.full) result.full = checks.full;
	if (checks.hotfix) result.hotfix = checks.hotfix;
	return result;
};

const renderDevPromotionConfig = (promotion: DevPromotionConfig): YamlObject => {
	const result: YamlObject = {
		strategy: promotion.strategy,
	};
	if (promotion.allowDirectProductionMerge) {
		result.allow_direct_production_merge = true;
	}
	if (promotion.blockEnvironmentToProduction) {
		result.block_environment_to_production = true;
	}
	if (promotion.requireConfirmProduction) {
		result.require_confirm_production = true;
	}
	if (promotion.requireReadyForProduction) {
		result.require_ready_for_production = true;
	}
	return result;
};

const renderDevCommitConfig = (commit: DevCommitConfig): YamlObject => {
	const result: YamlObject = {};
	if (commit.conventional) result.conventional = true;
	if (commit.allowWipOnReady) result.allow_wip_on_ready = true;
	return result;
};

export const parseOssConfig = (raw: unknown): OssConfig | undefined => {
	const oss = objectValue(raw);
	if (!oss) return undefined;

	const sync = parseOssSyncConfig(oss.sync);
	if (!sync) return undefined;

	const environments: Record<string, OssEnvironmentConfig> = {};
	for (const key of Object.keys(oss)) {
		if (key === "sync") continue;
		const env = parseOssEnvConfig(oss[key]);
		if (env) environments[key] = env;
	}

	if (Object.keys(environments).length === 0) return undefined;

	return { environments, sync };
};

export const renderOssConfig = (input: OssSetupInput, existingText: string): string => {
	const existing = parseYaml(existingText);
	const envKey = input.env;

	const existingOss = objectValue(existing.oss);

	const mergedOss: YamlObject = {
		...existingOss,
		[envKey]: {
			...(existingOss[envKey] as YamlObject | undefined),
			endpoint: input.config.endpoint,
			region: input.config.region,
			...(input.config.bucket ? { bucket: input.config.bucket } : {}),
		},
		sync: {
			...(existingOss.sync as YamlObject | undefined),
			local_dir: input.sync.localDir,
			...(input.sync.remotePrefix ? { remote_prefix: input.sync.remotePrefix } : {}),
			concurrency: input.sync.concurrency ?? 10,
		},
	};

	const ordered: YamlObject = {};
	for (const [key, value] of Object.entries(existing)) {
		if (key === "oss") {
			ordered[key] = mergedOss;
		} else {
			ordered[key] = value;
		}
	}
	if (!("oss" in existing)) {
		ordered.oss = mergedOss;
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

type OpenApiTemplateInput = {
	entry: OpenApiGenConfig;
	force?: boolean;
};

export const renderOpenApiConfig = (input: OpenApiTemplateInput, existingText: string): string => {
	const existing = parseYaml(existingText);
	const existingOpenapi = existing.openapi;
	const existingEntries = parseOpenapiConfig(existingOpenapi)?.entries ?? [];
	const nextEntries = (input.force ? [] : existingEntries).map(formatOpenApiEntryForYaml);
	nextEntries.push(formatOpenApiEntryForYaml(input.entry));

	const nextOpenapi: YamlObject =
		existingOpenapi && typeof existingOpenapi === "object" && !Array.isArray(existingOpenapi)
			? ({ ...(existingOpenapi as YamlObject), entries: nextEntries } as YamlObject)
			: ({ entries: nextEntries } as YamlObject);

	const ordered: YamlObject = {};
	for (const [key, value] of Object.entries(existing)) {
		if (key === "openapi") {
			ordered[key] = nextOpenapi;
		} else {
			ordered[key] = value;
		}
	}
	if (!("openapi" in existing)) {
		ordered.openapi = nextOpenapi;
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

const formatOpenApiEntryForYaml = (entry: OpenApiGenConfig): YamlObject => {
	const result: YamlObject = {
		input: entry.input,
		output: entry.output,
		client: entry.client,
	};
	if (entry.apiName !== undefined) result.apiName = entry.apiName;
	if (entry.typesName !== undefined) result.typesName = entry.typesName;
	if (entry.runtimeName !== undefined) result.runtimeName = entry.runtimeName;
	if (entry.posthook !== undefined) result.posthook = entry.posthook;
	if (entry.shareRuntime !== undefined) result.shareRuntime = entry.shareRuntime;
	if (entry.headers !== undefined) result.headers = entry.headers as YamlValue;
	if (entry.stateManagement !== undefined) result.stateManagement = entry.stateManagement;
	return result;
};

export const parseCredentialsJson = (text: string, path: string): Credentials => {
	if (text.trim() === "") {
		throw new FileError({ message: `No token in ${path}`, path });
	}

	const raw = parseFlatJson(text, path);
	const token = typeof raw.token === "string" ? raw.token : "";
	if (token === "") {
		throw new FileError({ message: `No token in ${path}`, path });
	}

	return { token };
};

export const parseOfficialConfig = (
	text: string,
	path: string,
): Credentials & { account: string } => {
	try {
		const raw = Bun.YAML.parse(text);
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			throw new Error("expected YAML object");
		}

		const obj = raw as YamlObject;
		return {
			account: coerceStringValue(obj.account),
			token: coerceStringValue(obj.token),
		};
	} catch (cause) {
		throw new FileError({ message: `Invalid official config in ${path}: ${String(cause)}`, path });
	}
};

export const parseYaml = (text: string): YamlObject => {
	if (text.trim() === "") {
		return {};
	}

	const value = Bun.YAML.parse(text);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ConfigError({ message: "Invalid config format: expected YAML object" });
	}

	return value as YamlObject;
};

const parseFlowConfig = (raw: unknown): FlowConfig | undefined => {
	const flow = objectValue(raw);
	const columns = objectValue(flow.columns);
	const todo = stringValue(columns.todo);
	const inProgress = stringValue(columns.in_progress) || stringValue(columns.inProgress);
	if (!todo || !inProgress) return undefined;

	const parsedUsers: Record<string, string> = {};
	for (const [key, value] of Object.entries(objectValue(flow.users))) {
		const userId = stringValue(value);
		if (userId) parsedUsers[key] = userId;
	}

	return {
		columns: {
			todo,
			inProgress,
		},
		users: parsedUsers,
		wipLimit: numberValue(flow.wip_limit) || DEFAULT_WIP_LIMIT,
		cacheTtlSeconds: numberValue(flow.cache_ttl) || DEFAULT_CACHE_TTL_SECONDS,
		tags: parseFlowTagConfig(flow.tags),
	};
};

const parseDevConfig = (raw: unknown): DevConfig | undefined => {
	const dev = objectValue(raw);
	const productionBranch = stringValue(dev.production_branch);
	const defaultBase = stringValue(dev.default_base);
	const syncStrategy = parseDevSyncStrategy(dev.sync_strategy);
	const protectedBranches = stringArrayValue(dev.protected_branches);
	const environmentBranches = parseDevEnvironmentBranches(dev.environment_branches);
	const branchPrefixes = parseDevBranchPrefixes(dev.branch_prefixes);
	const checks = parseDevChecksConfig(dev.checks);
	const promotion = parseDevPromotionConfig(dev.promotion);
	const staleAfterDays = parseIntegerValue(dev.stale_after_days);
	const commit = parseDevCommitConfig(dev.commit);
	const branches = parseDevBranches(dev.branches);

	const parsed: DevConfig = {};
	if (productionBranch) parsed.productionBranch = productionBranch;
	if (defaultBase) parsed.defaultBase = defaultBase;
	if (syncStrategy) parsed.syncStrategy = syncStrategy;
	if (protectedBranches) parsed.protectedBranches = protectedBranches;
	if (environmentBranches) parsed.environmentBranches = environmentBranches;
	if (branchPrefixes) parsed.branchPrefixes = branchPrefixes;
	if (checks) parsed.checks = checks;
	if (promotion) parsed.promotion = promotion;
	if (staleAfterDays !== undefined) parsed.staleAfterDays = staleAfterDays;
	if (commit) parsed.commit = commit;
	if (branches) parsed.branches = branches;

	if (Object.keys(parsed).length === 0) return undefined;
	return parsed;
};

const parseDevEnvironmentBranches = (
	raw: unknown,
): Record<string, DevEnvironmentBranchConfig> | undefined => {
	const envs = objectValue(raw);
	const parsed: Record<string, DevEnvironmentBranchConfig> = {};
	for (const [name, value] of Object.entries(envs)) {
		const env = objectValue(value);
		const deploysTo = stringValue(env.deploys_to);
		const aggregate = env.aggregate === true;
		const entry: DevEnvironmentBranchConfig = {};
		if (deploysTo) entry.deploysTo = deploysTo;
		if (aggregate) entry.aggregate = true;
		if (Object.keys(entry).length > 0) {
			parsed[name] = entry;
		}
	}

	if (Object.keys(parsed).length === 0) return undefined;
	return parsed;
};

const parseDevBranchPrefixes = (raw: unknown): Partial<DevBranchPrefixConfig> | undefined => {
	const obj = objectValue(raw);
	const parsed: Partial<DevBranchPrefixConfig> = {};

	const feature = stringValue(obj.feature);
	const fix = stringValue(obj.fix);
	const hotfix = stringValue(obj.hotfix);
	const ops = stringValue(obj.ops);
	const chore = stringValue(obj.chore);
	const docs = stringValue(obj.docs);
	const maintenance = stringValue(obj.maintenance);

	if (feature) parsed.feature = feature;
	if (fix) parsed.fix = fix;
	if (hotfix) parsed.hotfix = hotfix;
	if (ops) parsed.ops = ops;
	if (chore) parsed.chore = chore;
	if (docs) parsed.docs = docs;
	if (maintenance) parsed.maintenance = maintenance;

	if (Object.keys(parsed).length === 0) return undefined;
	return parsed;
};

const parseDevChecksConfig = (raw: unknown): DevChecksConfig | undefined => {
	const obj = objectValue(raw);
	const ready = stringArrayValue(obj.ready);
	const full = stringArrayValue(obj.full);
	const hotfix = stringArrayValue(obj.hotfix);
	if (!ready && !full && !hotfix) return undefined;

	return {
		ready,
		full,
		hotfix,
	};
};

const parseDevPromotionConfig = (raw: unknown): DevPromotionConfig | undefined => {
	const obj = objectValue(raw);
	const strategy = parseDevPromotionStrategy(obj.strategy);
	if (!strategy) return undefined;

	const config: DevPromotionConfig = { strategy };

	if (obj.allow_direct_production_merge === true) {
		config.allowDirectProductionMerge = true;
	}
	if (obj.block_environment_to_production === true) {
		config.blockEnvironmentToProduction = true;
	}
	if (obj.require_confirm_production === true) {
		config.requireConfirmProduction = true;
	}
	if (obj.require_ready_for_production === true) {
		config.requireReadyForProduction = true;
	}

	return config;
};

const parseDevCommitConfig = (raw: unknown): DevCommitConfig | undefined => {
	const obj = objectValue(raw);
	const commit: DevCommitConfig = {};
	if (obj.conventional === true) commit.conventional = true;
	if (obj.allow_wip_on_ready === true) commit.allowWipOnReady = true;
	if (Object.keys(commit).length === 0) return undefined;
	return commit;
};

const parseDevBranches = (raw: unknown): Record<string, DevBranchMetadata> | undefined => {
	const branches = objectValue(raw);
	const parsed: Record<string, DevBranchMetadata> = {};
	for (const [name, value] of Object.entries(branches)) {
		const branchObj = objectValue(value);
		const metadata: DevBranchMetadata = {};

		const card = parseIntegerValue(branchObj.card);
		if (card !== undefined) metadata.card = card;

		const kind = stringValue(branchObj.kind);
		if (kind) metadata.kind = kind;

		const base = stringValue(branchObj.base);
		if (base) metadata.base = base;

		const createdAt = stringValue(branchObj.created_at);
		if (createdAt) metadata.createdAt = createdAt;

		if (Object.keys(metadata).length > 0) {
			parsed[name] = metadata;
		}
	}

	if (Object.keys(parsed).length === 0) return undefined;
	return parsed;
};

const parseDevSyncStrategy = (raw: unknown): DevConfig["syncStrategy"] | undefined => {
	if (raw !== "rebase" && raw !== "merge" && raw !== "none") return undefined;
	return raw;
};

const parseDevPromotionStrategy = (raw: unknown): DevPromotionConfig["strategy"] | undefined => {
	if (raw !== "pr" && raw !== "merge" && raw !== "squash") return undefined;
	return raw;
};

const parseFlowTagConfig = (raw: unknown): FlowTagConfig | undefined => {
	const obj = objectValue(raw);
	if (Object.keys(obj).length === 0) return undefined;

	const areas = stringArrayValue(obj.areas);
	const phases = stringArrayValue(obj.phases);
	if (!areas && !phases) return undefined;

	return {
		areas: areas ?? [],
		phases: phases ?? [],
	};
};

const parseProjectSkillsConfig = (raw: unknown): ProjectSkillsConfig | undefined => {
	const obj = objectValue(raw);
	const version = numberValue(obj.version);
	if (!version) return undefined;

	return {
		version,
		sources: parseProjectSkillSources(obj.sources),
		installed: parseInstalledSkills(obj.installed),
		defaults: parseSkillMap(obj.defaults),
		areas: parseSkillMap(obj.areas),
	};
};

const parseProjectSkillSources = (raw: unknown): Record<string, ProjectSkillSourceConfig> => {
	const obj = objectValue(raw);
	const sources: Record<string, ProjectSkillSourceConfig> = {};

	for (const [key, value] of Object.entries(obj)) {
		const sourceObj = objectValue(value);
		const repo = stringValue(sourceObj.repo);
		if (!repo) continue;
		const source: ProjectSkillSourceConfig = { repo };
		const ref = stringValue(sourceObj.ref);
		if (ref) source.ref = ref;
		sources[key] = source;
	}

	return sources;
};

const parseInstalledSkills = (raw: unknown): Record<string, ProjectInstalledSkillConfig> => {
	const obj = objectValue(raw);
	const installed: Record<string, ProjectInstalledSkillConfig> = {};

	for (const [key, value] of Object.entries(obj)) {
		const skillObj = objectValue(value);
		const source = stringValue(skillObj.source);
		if (!source) continue;
		const installedSkill: ProjectInstalledSkillConfig = { source };
		const version = stringValue(skillObj.version);
		const repo = stringValue(skillObj.repo);
		const ref = stringValue(skillObj.ref);
		const commit = stringValue(skillObj.commit);
		const path = stringValue(skillObj.path);

		if (version) installedSkill.version = version;
		if (repo) installedSkill.repo = repo;
		if (ref) installedSkill.ref = ref;
		if (commit) installedSkill.commit = commit;
		if (path) installedSkill.path = path;

		installed[key] = installedSkill;
	}

	return installed;
};

const parseSkillMap = (raw: unknown): Record<string, ReadonlyArray<string>> => {
	const obj = objectValue(raw);
	const parsed: Record<string, ReadonlyArray<string>> = {};

	for (const [key, value] of Object.entries(obj)) {
		const names = stringArrayValue(value);
		if (names) parsed[key] = names;
	}

	return parsed;
};

const parseOssEnvConfig = (raw: unknown): OssEnvironmentConfig | undefined => {
	const obj = objectValue(raw);
	const endpoint = stringValue(obj.endpoint);
	const region = stringValue(obj.region);
	const bucket = stringValue(obj.bucket);
	if (!endpoint || !region) return undefined;
	const config: OssEnvironmentConfig = { endpoint, region };
	if (bucket) config.bucket = bucket;
	const accessKeyId = stringValue(obj.access_key_id);
	const secretAccessKey = stringValue(obj.secret_access_key);
	if (accessKeyId) config.accessKeyId = accessKeyId;
	if (secretAccessKey) config.secretAccessKey = secretAccessKey;
	return config;
};

const parseOpenapiConfig = (raw: unknown): OpenApiProjectConfig | undefined => {
	const arr = arrayValue(raw);
	if (arr) {
		const entries = parseOpenapiEntries(arr);
		return entries ? { entries } : undefined;
	}

	const obj = objectValue(raw);
	const admin = parseOpenapiAdminConfig(obj.admin);
	const entriesRaw = obj.entries;
	if (entriesRaw) {
		const entries = parseOpenapiEntries(entriesRaw);
		if (!entries && !admin) return undefined;
		return {
			posthook: stringValue(obj.posthook) || undefined,
			entries: entries ?? [],
			admin,
		};
	}

	return admin ? { posthook: stringValue(obj.posthook) || undefined, admin } : undefined;
};

const parseOpenapiAdminAuth = (raw: unknown): ParsedAdminAuthConfig | undefined => {
	const auth = objectValue(raw);
	const mode = stringValue(auth.mode);
	const loginOperationId = stringValue(auth.login_operation_id);
	if ((mode !== "server-cookie" && mode !== "upstream-cookie") || !loginOperationId) {
		return undefined;
	}
	const routes = objectValue(auth.routes);
	return {
		mode,
		loginOperationId,
		logoutOperationId: stringValue(auth.logout_operation_id) || undefined,
		meOperationId: stringValue(auth.me_operation_id) || undefined,
		refreshOperationId: stringValue(auth.refresh_operation_id) || undefined,
		usernameField: stringValue(auth.username_field) || undefined,
		passwordField: stringValue(auth.password_field) || undefined,
		accessTokenPath: stringValue(auth.access_token_path) || undefined,
		refreshTokenPath: stringValue(auth.refresh_token_path) || undefined,
		expiresInPath: stringValue(auth.expires_in_path) || undefined,
		routes: {
			login: stringValue(routes.login) || "/login",
			afterLogin: stringValue(routes.after_login) || "/",
		},
	};
};

const parseOpenapiAdminConfig = (raw: unknown): OpenApiAdminProjectConfig | undefined => {
	const admin = objectValue(raw);
	const input = stringValue(admin.input) || undefined;
	const output = stringValue(admin.output) || undefined;
	const frameworkValue = stringValue(admin.framework);
	const framework =
		frameworkValue === "nextjs" || frameworkValue === "tanstack-start" ? frameworkValue : undefined;
	const preset = stringValue(admin.preset) || undefined;
	const createModeValue = stringValue(admin.create_mode);
	const createMode =
		createModeValue === "page" || createModeValue === "dialog" ? createModeValue : undefined;
	const auth = parseOpenapiAdminAuth(admin.auth);
	if (!input && !output && !framework && !preset && !createMode && !auth) return undefined;
	return { input, output, framework, preset, createMode, auth };
};

const parseOpenapiEntries = (raw: unknown): OpenApiGenConfig[] | undefined => {
	const arr = arrayValue(raw);
	if (!arr) return undefined;
	const entries: OpenApiGenConfig[] = [];
	for (const item of arr) {
		const obj = objectValue(item);
		const input = stringValue(obj.input);
		const output = stringValue(obj.output);
		const client = stringValue(obj.client);
		if (!input || !output || !client) continue;
		const stateManagement = stringValue(obj.stateManagement) || undefined;
		entries.push({
			input,
			output,
			client,
			apiName: stringValue(obj.apiName) || undefined,
			typesName: stringValue(obj.typesName) || undefined,
			runtimeName: stringValue(obj.runtimeName) || undefined,
			posthook: stringValue(obj.posthook) || undefined,
			shareRuntime: obj.shareRuntime === true || undefined,
			headers: parseObjectHeaders(obj.headers),
			stateManagement,
		});
	}
	return entries.length > 0 ? entries : undefined;
};

const parseOssSyncConfig = (raw: unknown): OssSyncConfig | undefined => {
	const obj = objectValue(raw);
	const localDir = stringValue(obj.local_dir);
	const remotePrefix = stringValue(obj.remote_prefix);
	if (!localDir) return undefined;
	return {
		localDir,
		remotePrefix: remotePrefix ?? "",
		concurrency: numberValue(obj.concurrency) || 10,
	};
};

const parseFlatJson = (text: string, path: string): Record<string, unknown> => {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	} catch (cause) {
		throw new FileError({ message: `Invalid JSON in ${path}: ${String(cause)}`, path });
	}
};

const parseUsersInput = (users: Record<string, string>): YamlObject => {
	const result: YamlObject = {};
	for (const [name, id] of Object.entries(users)) {
		result[name] = id;
	}
	return result;
};

const stringValue = (value: unknown): string => (typeof value === "string" ? value : "");

const coerceStringValue = (value: unknown): string =>
	typeof value === "string" || typeof value === "number" ? value.toString() : "";

const numberValue = (value: unknown): number => {
	if (typeof value === "number") return Number.isFinite(value) ? value : 0;
	return Number.parseInt(stringValue(value), 10) || 0;
};

const parseIntegerValue = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value !== "string") return undefined;
	const valueAsNumber = Number.parseInt(value, 10);
	return Number.isFinite(valueAsNumber) ? valueAsNumber : undefined;
};

const objectValue = (value: unknown): YamlObject =>
	value && typeof value === "object" && !Array.isArray(value) ? (value as YamlObject) : {};

const arrayValue = (value: unknown): readonly YamlValue[] | undefined =>
	Array.isArray(value) ? (value as readonly YamlValue[]) : undefined;

const stringArrayValue = (value: unknown): string[] | undefined => {
	const arr = arrayValue(value);
	if (!arr) return undefined;
	const result = arr.map(stringValue).filter((item) => item !== "");
	return result;
};

const parseObjectHeaders = (raw: unknown): Record<string, string> | undefined => {
	const obj = objectValue(raw);
	if (Object.keys(obj).length === 0) return undefined;
	const result: Record<string, string> = {};
	for (const [key, value] of Object.entries(obj)) {
		const val = stringValue(value);
		if (val) result[key] = val;
	}
	return Object.keys(result).length > 0 ? result : undefined;
};

export const serializeProjectConfig = (config: ProjectConfig): string => {
	const ordered: YamlObject = {};

	ordered.api_url = config.apiUrl;
	ordered.account = config.account;
	if (config.board) ordered.board = config.board;

	if (config.dev) {
		const rendered = renderDevConfig(config.dev);
		if (Object.keys(rendered).length > 0) {
			ordered.dev = rendered;
		}
	}

	if (config.flow) {
		ordered.flow = renderFlowConfig(config.flow);
	}

	if (config.oss) {
		ordered.oss = renderOssConfigFlat(config.oss);
	}

	if (config.openapi) {
		ordered.openapi = renderOpenApiConfigFlat(config.openapi);
	}

	if (config.skills) {
		ordered.skills = renderSkillsConfig(config.skills);
	}

	return Bun.YAML.stringify(ordered, null, 2);
};

const renderFlowConfig = (flow: FlowConfig): YamlObject => ({
	columns: {
		todo: flow.columns.todo,
		in_progress: flow.columns.inProgress,
	},
	users: Object.fromEntries(Object.entries(flow.users).map(([k, v]) => [k, v])),
	wip_limit: flow.wipLimit,
	cache_ttl: flow.cacheTtlSeconds,
});

const renderOssConfigFlat = (oss: OssConfig): YamlObject => {
	const result: YamlObject = {};
	if (oss.sync) {
		result.sync = {
			local_dir: oss.sync.localDir,
			remote_prefix: oss.sync.remotePrefix ?? "",
			concurrency: oss.sync.concurrency ?? 10,
		};
	}
	for (const [env, config] of Object.entries(oss.environments)) {
		const envObj: YamlObject = { endpoint: config.endpoint, region: config.region };
		if (config.bucket) envObj.bucket = config.bucket;
		result[env] = envObj;
	}
	return result;
};

const renderOpenApiConfigFlat = (openapi: OpenApiProjectConfig): YamlObject => {
	const result: YamlObject = {};
	if (openapi.posthook) result.posthook = openapi.posthook;
	if (openapi.entries) {
		result.entries = openapi.entries.map((entry) => ({
			input: entry.input,
			output: entry.output,
			client: entry.client,
		}));
	}
	if (openapi.admin) {
		const admin: YamlObject = {};
		if (openapi.admin.input) admin.input = openapi.admin.input;
		if (openapi.admin.output) admin.output = openapi.admin.output;
		if (openapi.admin.framework) admin.framework = openapi.admin.framework;
		if (openapi.admin.preset) admin.preset = openapi.admin.preset;
		if (openapi.admin.createMode) admin.create_mode = openapi.admin.createMode;
		if (openapi.admin.auth) {
			const auth = openapi.admin.auth;
			admin.auth = {
				mode: auth.mode,
				login_operation_id: auth.loginOperationId,
				...(auth.logoutOperationId ? { logout_operation_id: auth.logoutOperationId } : {}),
				...(auth.meOperationId ? { me_operation_id: auth.meOperationId } : {}),
				...(auth.refreshOperationId ? { refresh_operation_id: auth.refreshOperationId } : {}),
				...(auth.usernameField ? { username_field: auth.usernameField } : {}),
				...(auth.passwordField ? { password_field: auth.passwordField } : {}),
				...(auth.accessTokenPath ? { access_token_path: auth.accessTokenPath } : {}),
				...(auth.refreshTokenPath ? { refresh_token_path: auth.refreshTokenPath } : {}),
				...(auth.expiresInPath ? { expires_in_path: auth.expiresInPath } : {}),
				routes: { login: auth.routes.login, after_login: auth.routes.afterLogin },
			};
		}
		result.admin = admin;
	}
	return result;
};

const renderSkillsConfig = (skills: ProjectSkillsConfig): YamlObject => {
	const result: YamlObject = { version: skills.version };

	if (Object.keys(skills.sources).length > 0) {
		const sources: Record<string, YamlObject> = {};
		for (const [k, v] of Object.entries(skills.sources)) {
			const entry: YamlObject = { repo: v.repo };
			if (v.ref) entry.ref = v.ref;
			sources[k] = entry;
		}
		result.sources = sources;
	}

	if (Object.keys(skills.installed).length > 0) {
		const installed: Record<string, YamlObject> = {};
		for (const [k, v] of Object.entries(skills.installed)) {
			const entry: YamlObject = { source: v.source };
			if (v.version) entry.version = v.version;
			if (v.repo) entry.repo = v.repo;
			if (v.ref) entry.ref = v.ref;
			if (v.commit) entry.commit = v.commit;
			if (v.path) entry.path = v.path;
			installed[k] = entry;
		}
		result.installed = installed;
	}

	if (Object.keys(skills.defaults).length > 0) {
		const defaults: Record<string, readonly YamlValue[]> = {};
		for (const [k, v] of Object.entries(skills.defaults)) {
			defaults[k] = [...v];
		}
		result.defaults = defaults;
	}

	if (Object.keys(skills.areas).length > 0) {
		const areas: Record<string, readonly YamlValue[]> = {};
		for (const [k, v] of Object.entries(skills.areas)) {
			areas[k] = [...v];
		}
		result.areas = areas;
	}

	return result;
};

type YamlValue = string | number | boolean | null | YamlObject | readonly YamlValue[];

interface YamlObject {
	[key: string]: YamlValue;
}
