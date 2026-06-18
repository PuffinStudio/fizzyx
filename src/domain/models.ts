export type CardNumber = number;

export interface FlowConfig {
	columns: {
		todo: string;
		inProgress: string;
	};
	users: Record<string, string>;
	wipLimit: number;
	cacheTtlSeconds: number;
}

export interface Board {
	id: string;
	name: string;
}

export interface ProjectConfig {
	apiUrl: string;
	account: string;
	board?: string;
	flow?: FlowConfig;
	oss?: OssConfig;
	configPath: string;
	rootDir: string;
}

export interface OfficialConfig {
	token: string;
	account: string;
	apiUrl: string;
	board?: string;
}

export interface InitializedProjectConfig extends ProjectConfig {
	flow: FlowConfig;
}

export interface Credentials {
	token: string;
}

export interface Assignee {
	id: string;
	name: string;
}

export interface ColumnRef {
	id?: string;
	name?: string;
}

export interface Step {
	id?: string;
	content: string;
	completed: boolean;
}

export interface Comment {
	created_at?: string;
	creator?: { name?: string };
	body?: { plain_text?: string };
}

export interface Card {
	id?: string;
	number: CardNumber;
	title: string;
	description?: string;
	descriptionHtml?: string;
	column?: ColumnRef;
	assignees?: ReadonlyArray<Assignee>;
	closed?: boolean;
	golden?: boolean;
	steps?: ReadonlyArray<Step>;
}

export interface Identity {
	userId: string;
	name?: string;
	email?: string;
}

export interface BoardCache {
	identity: Identity;
	cards: ReadonlyArray<Card>;
	notNow: ReadonlyArray<Card>;
	columns: ReadonlyArray<BoardColumn>;
	users: Record<string, string>;
	syncedAt: string;
}

export interface BoardColumn {
	id: string;
	name: string;
}

// ─── OSS / S3-compatible storage ────────────────────────────

export type OssEnvironmentName = string;

export interface OssCredentials {
	accessKeyId: string;
	secretAccessKey: string;
}

export interface OssEnvironmentConfig {
	endpoint: string;
	region: string;
	bucket?: string;
	accessKeyId?: string;
	secretAccessKey?: string;
}

export interface OssSyncConfig {
	localDir: string;
	remotePrefix?: string;
	concurrency: number;
}

export interface OssConfig {
	environments: Record<string, OssEnvironmentConfig>;
	sync: OssSyncConfig;
}

export interface SyncEntry {
	mtimeMs: number;
	size: number;
	hash: string;
}

export interface SyncManifest {
	version: 1;
	localDir: string;
	remotePrefix: string;
	lastSyncedAt: string;
	files: Record<string, SyncEntry>;
}

export interface OssSyncSummary {
	env: OssEnvironmentName;
	endpoint: string;
	bucket: string;
	remotePrefix: string;
	uploaded: number;
	skipped: number;
	uploadedKeys: ReadonlyArray<string>;
	allKeys: ReadonlyArray<string>;
	durationMs: number;
	errors: ReadonlyArray<string>;
}

export interface OssStatusResult {
	env: OssEnvironmentName;
	pendingUploads: number;
	pendingDeletions: number;
	pendingUploadFiles: ReadonlyArray<string>;
	pendingDeletionFiles: ReadonlyArray<string>;
	totalLocal: number;
	manifestEntries: number;
	manifestPath: string;
}

export interface S3ObjectInfo {
	key: string;
	eTag?: string;
	lastModified?: string;
	size?: number;
}

export interface OssListResult {
	objects: ReadonlyArray<S3ObjectInfo>;
	isTruncated: boolean;
}
