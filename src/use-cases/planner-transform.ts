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
import { convertDescription } from "./flow-card-content";

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
	const owner = parsed.metadata.owner || card.assignees?.[0]?.name;
	const existingPriority = normalizePriority(parsed.metadata.priority);
	const tagPriority = normalizePriority(tags.priority[0]);
	const priority =
		tagPriority || options.defaultPriority || existingPriority || parsed.metadata.priority;
	const normalizedPriority = normalizePriority(priority);
	const type = parsed.metadata.type || tags.type[0] || options.defaultType;
	const phase = parsed.metadata.phase || tags.phase[0];
	const metadata: PlannerMetadata = {
		priority: normalizedPriority
			? normalizedPriority.toUpperCase()
			: priority
				? priority.toUpperCase()
				: "",
		type: type || "",
		owner: owner || "",
		deadline: parsed.metadata.deadline || "",
		impact: parsed.metadata.impact || "",
		effort: parsed.metadata.effort || "",
		depends_on: parsed.metadata.depends_on,
		blocks: parsed.metadata.blocks,
		phase: phase || "",
		api_status: parsed.metadata.api_status || "",
	};

	const renderedDescription = convertDescription(
		`${renderMetadata(metadata)}${parsed.body ? `\n${parsed.body}` : ""}`.trimEnd(),
	);
	const needsSingleLineFrontmatterNormalization = parsed.warnings.includes(
		"normalized single-line frontmatter format",
	);
	const hasFrontmatter =
		description.trimStart().startsWith("---") || description.trimStart().startsWith("<!--");
	const reason = needsSingleLineFrontmatterNormalization
		? "normalize metadata frontmatter format"
		: hasFrontmatter
			? "sync metadata from tags/assignee"
			: "insert metadata frontmatter";

	if (
		renderedDescription === description &&
		parsed.metadata.owner === owner &&
		existingPriority === normalizedPriority &&
		parsed.metadata.type === type &&
		parsed.metadata.phase === phase
	) {
		return {
			cardNumber: card.number,
			title: card.title,
			action: "skip",
			reason: "metadata already present",
		};
	}

	return {
		cardNumber: card.number,
		title: card.title,
		action: "update_description",
		reason,
		description: renderedDescription,
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
