import { ValidationError } from "../domain/errors";
import type {
	BoardCache,
	Card,
	Identity,
	InitializedProjectConfig,
	ProjectConfig,
} from "../domain/models";

const USER_ID_PATTERN = /^03[a-z0-9]{23}$/;
const CURRENT_USER_ALIASES = new Set(["me", "self", "myself"]);

export const isCurrentUserAlias = (user: string): boolean =>
	CURRENT_USER_ALIASES.has(user.toLowerCase());

export const buildBoardUsers = (
	config: ProjectConfig,
	cards: ReadonlyArray<Card>,
): Record<string, string> => {
	const users = { ...config.flow?.users };
	for (const card of cards) {
		for (const assignee of card.assignees || []) {
			if (assignee.name) users[assignee.name] = assignee.id;
		}
	}
	return users;
};

export const mergeFlowUsers = (input: {
	config: ProjectConfig;
	initialUsers?: Record<string, string>;
	cards: ReadonlyArray<Card>;
	identity?: Identity;
}): Record<string, string> => {
	const users: Record<string, string> = {
		...input.initialUsers,
		...input.config.flow?.users,
	};

	Object.assign(users, buildBoardUsers(input.config, input.cards));
	if (input.identity?.name) {
		users[input.identity.name] = input.identity.userId;
	}

	return users;
};

export const resolveUser = (config: InitializedProjectConfig, user: string): string => {
	const exact = config.flow.users[user];
	if (exact) return exact;
	const lower = config.flow.users[user.toLowerCase()];
	if (lower) return lower;
	if (USER_ID_PATTERN.test(user)) return user;
	throw new ValidationError({ message: `Unknown user ${user}` });
};

export const resolveBoardUser = (boardUsers: Record<string, string>, user: string): string => {
	const exact = boardUsers[user];
	if (exact) return exact;
	const lower = boardUsers[user.toLowerCase()];
	if (lower) return lower;
	if (USER_ID_PATTERN.test(user)) {
		const knownIds = Object.values(boardUsers);
		if (!knownIds.includes(user)) {
			const members = Object.keys(boardUsers).join(", ");
			throw new ValidationError({
				message: `User ID ${user} is not a board member. Known members: ${members}`,
			});
		}
		return user;
	}
	const members = Object.keys(boardUsers).join(", ");
	throw new ValidationError({ message: `Unknown user "${user}". Board members: ${members}` });
};

export const resolveAssignableUser = (cache: BoardCache, user: string): string =>
	isCurrentUserAlias(user) ? cache.identity.userId : resolveBoardUser(cache.users, user);

export const findUserName = (cache: BoardCache, userId: string): string | undefined =>
	Object.entries(cache.users).find(([, id]) => id === userId)?.[0];

export const resolveMineUser = (
	config: InitializedProjectConfig,
	cache: BoardCache,
	user?: string,
): { name: string; userId: string } => {
	const userId = user ? resolveUser(config, user) : cache.identity.userId;
	const name = findUserName(cache, userId) || user || cache.identity.name || "me";
	return { name, userId };
};
