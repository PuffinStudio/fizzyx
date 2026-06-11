export type CardNumber = number;

export type FlowCardLanguage = "zh-CN" | "en" | "mixed";

export const DEFAULT_FLOW_CARD_LANGUAGE: FlowCardLanguage = "zh-CN";

export interface FlowCardConfig {
	language: FlowCardLanguage;
}

export interface FlowConfig {
	columns: {
		todo: string;
		inProgress: string;
	};
	users: Record<string, string>;
	wipLimit: number;
	cacheTtlSeconds: number;
	card: FlowCardConfig;
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
	users: Record<string, string>;
	syncedAt: string;
}

export interface BoardColumn {
	id: string;
	name: string;
}
