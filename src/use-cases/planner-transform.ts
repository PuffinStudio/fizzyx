import type {
	GetMyIdentityResponseContent,
	ListCommentsResponseContent,
} from "../fizzy-effect/types";
import type { Card, Column } from "../fizzy-effect/types";
import type {
	PlannerCard,
	PlannerComment,
	PlannerRepairMetadataChange,
	PlannerRepairMetadataOptions,
	PlannerUser,
} from "../domain/planner-model";
import type { PlannerMetadata, PlannerPriority } from "./planner-metadata";
import { parsePlannerDescription, parsePlannerTags } from "./planner-metadata";

export const normalizePriority = (priority?: string): PlannerPriority | undefined => {
	const value = priority?.trim().toLowerCase();
	return value === "p0" || value === "p1" || value === "p2" ? value : undefined;
};

export const mergeCards = (
	openCards: ReadonlyArray<Card>,
	postponedCards: ReadonlyArray<Card>,
	closedCards: ReadonlyArray<Card>,
): ReadonlyArray<Card> => {
	const byNumber = new Map<number, Card>();
	for (const card of openCards) byNumber.set(card.number, card);
	for (const card of postponedCards) byNumber.set(card.number, { ...card, postponed: true });
	for (const card of closedCards) byNumber.set(card.number, { ...card, closed: true });
	return Array.from(byNumber.values());
};

export const planMetadataRepair = (
	card: Card,
	options: PlannerRepairMetadataOptions,
	normalizePriority: (value?: string) => PlannerPriority | undefined,
): PlannerRepairMetadataChange => {
	const description = card.description_html || card.description || "";
	const parsed = parsePlannerDescription(description);
	const tags = parsePlannerTags(card.tags);
	const existingPriority = normalizePriority(parsed.metadata.priority);
	const tagPriority = normalizePriority(tags.priority[0]);
	const priority =
		tagPriority || options.defaultPriority || existingPriority || parsed.metadata.priority;
	const normalizedPriority = normalizePriority(priority);
	const type = parsed.metadata.type || tags.type[0] || options.defaultType;
	const phase = parsed.metadata.phase || tags.phase[0];
	const existingTags = new Set((card.tags || []).map((tag) => tag.toLowerCase()));
	const nextTags: string[] = [];
	if (normalizedPriority && !tags.priority.includes(normalizedPriority)) {
		nextTags.push(`priority:${normalizedPriority}`);
	}
	if (type && tags.type.length === 0) {
		nextTags.push(`type:${type.toLowerCase()}`);
	}
	if (phase && tags.phase.length === 0) {
		nextTags.push(`phase:${phase.toLowerCase()}`);
	}
	if (parsed.metadata.api_status && tags.apiStatus.length === 0) {
		nextTags.push(`api_status:${parsed.metadata.api_status.toLowerCase()}`);
	}
	for (const dependency of parsed.metadata.depends_on) {
		nextTags.push(`depends_on:${dependency}`);
	}
	for (const blocked of parsed.metadata.blocks) {
		nextTags.push(`blocks:${blocked}`);
	}
	const tagsToAdd = Array.from(new Set(nextTags)).filter((tag) => !existingTags.has(tag));

	if (tagsToAdd.length === 0) {
		return {
			cardNumber: card.number,
			title: card.title,
			action: "skip",
			reason: "metadata tags already present",
		};
	}

	return {
		cardNumber: card.number,
		title: card.title,
		action: "tag_card",
		reason: "sync planner metadata tags",
		tags: tagsToAdd,
	};
};

export const renderMetadata = (metadata: PlannerMetadata): string => {
	const lines: string[] = ["---"];
	if (metadata.priority) lines.push(`priority: ${metadata.priority.toUpperCase()}`);
	if (metadata.type) lines.push(`type: ${metadata.type}`);
	if (metadata.owner) lines.push(`owner: ${metadata.owner}`);
	if (metadata.deadline) lines.push(`deadline: ${metadata.deadline}`);
	if (metadata.impact) lines.push(`impact: ${metadata.impact}`);
	if (metadata.effort) lines.push(`effort: ${metadata.effort}`);
	if (metadata.depends_on.length > 0) lines.push(`depends_on: [${metadata.depends_on.join(", ")}]`);
	if (metadata.blocks.length > 0) lines.push(`blocks: [${metadata.blocks.join(", ")}]`);
	if (metadata.phase) lines.push(`phase: ${metadata.phase}`);
	if (metadata.api_status) lines.push(`api_status: ${metadata.api_status}`);
	return `${[...lines, "---"].join("\n")}\n`;
};

export const toPlannerCard = (
	card: Card,
	columns: ReadonlyArray<Column>,
	account: string,
): PlannerCard => {
	const parsedDescription = parsePlannerDescription(card.description_html || card.description);
	const parsedTags = parsePlannerTags(card.tags);
	const tagPriority = normalizePriority(parsedTags.priority[0]);
	const metadata: PlannerMetadata = {
		...parsedDescription.metadata,
		...(tagPriority ? { priority: tagPriority.toUpperCase() } : {}),
		...(parsedTags.type[0] ? { type: parsedTags.type[0] } : {}),
		...(parsedTags.phase[0] ? { phase: parsedTags.phase[0] } : {}),
		...(parsedTags.apiStatus[0] ? { api_status: parsedTags.apiStatus[0] } : {}),
		depends_on:
			parsedTags.dependsOn.length > 0
				? parsedTags.dependsOn
				: parsedDescription.metadata.depends_on,
		blocks: parsedTags.blocks.length > 0 ? parsedTags.blocks : parsedDescription.metadata.blocks,
	};
	const completed = (card.steps || []).filter((step) => step.completed).length;
	const total = (card.steps || []).length;

	return {
		number: card.number,
		title: card.title,
		lane: resolveLane(card, columns),
		column: card.column ? { id: card.column.id, name: card.column.name } : undefined,
		closed: card.closed,
		postponed: card.postponed,
		tags: card.tags || [],
		parsedTags,
		metadata,
		metadataWarnings: parsedDescription.warnings,
		body: parsedDescription.body,
		assignees: (card.assignees || []).map((u) => toPlannerUser(u, account)),
		createdAt: card.created_at,
		lastActiveAt: card.last_active_at,
		steps: (card.steps || []).map((step) => ({
			id: step.id,
			content: step.content,
			completed: step.completed,
		})),
		comments: [],
		stepProgress: { completed, total },
		url: card.url,
	};
};

export const toPlannerComment = (
	comment: ListCommentsResponseContent,
	account: string,
): PlannerComment => ({
	id: comment.id,
	createdAt: comment.created_at,
	body: comment.body.plain_text,
	creator: toPlannerUser(comment.creator, account),
});

export const fixAvatarUrl = (url: string | undefined, account: string): string | undefined => {
	if (!url) return url;
	const prefix = `/users/`;
	const idx = url.indexOf(prefix);
	if (idx === -1) return url;
	const before = url.slice(0, idx);
	const rest = url.slice(idx);
	if (before.endsWith(`/${account}`)) return url;
	return `${before}/${account}${rest}`;
};

export const toPlannerUser = (
	user: { id: string; name: string; avatar_url?: string },
	account: string,
): PlannerUser => ({
	id: user.id,
	name: user.name,
	avatarUrl: fixAvatarUrl(user.avatar_url, account),
});

export const toIdentityUser = (
	identity: GetMyIdentityResponseContent,
	account: string,
): PlannerUser => {
	const accountUser = identity.accounts[0]?.user;
	return {
		id: accountUser?.id || identity.id,
		name: accountUser?.name || identity.name || "Current user",
		avatarUrl: fixAvatarUrl(accountUser?.avatar_url, account),
	};
};

export const restrictUsersToConfig = (
	users: ReadonlyArray<PlannerUser>,
	identity: PlannerUser | undefined,
	configUsers?: Record<string, string>,
): ReadonlyArray<PlannerUser> => {
	const configuredUserIds = new Set(Object.values(configUsers || {}));
	if (configuredUserIds.size === 0) return users;

	const byId = new Map(users.map((user) => [user.id, user]));
	const restricted = [...configuredUserIds]
		.map((id) => byId.get(id) || (identity?.id === id ? identity : undefined))
		.filter((user): user is PlannerUser => user !== undefined);

	return restricted;
};

export const resolveLane = (card: Card, _columns: ReadonlyArray<Column>): PlannerCard["lane"] => {
	if (card.closed) return "done";
	if (card.postponed) return "blocked";
	const name = normalizeColumnName(card.column?.name || "");
	if (name === "notnow" || name === "blocked") return "blocked";
	if (name === "backlog" || name === "todo") return "todo";
	if (name === "ready") return "ready";
	if (name === "inprogress") return "in_progress";
	if (name === "review") return "review";
	if (name === "done") return "done";
	return "todo";
};

export const normalizeColumnName = (name: string): string =>
	name.trim().toLowerCase().replace(/\s+/g, "");
