import { Console, Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { Card, ProjectSkillsConfig } from "../../domain/models";
import { printCards } from "../render";
import { mine, nextOrStart, status } from "../../use-cases/flow-service";
import { runWithFlowEnv } from "../flow-workflow";
import {
	formatLoadingWorkSummaryMessage,
	formatNoCurrentWork,
	formatNoTodoCard,
	formatNotNowSection,
	formatNextActionHint,
	formatNextSummary,
	formatWorkBoardSummary,
	formatWorkHeader,
	formatWorkSection,
} from "../flow-output";

type WorkHealth = {
	tagIssues: number;
	inputsNeeded: ReadonlyArray<string>;
	suggestedSkills: ReadonlyArray<string>;
};

const DEFAULT_SKILLS_BY_TYPE: Record<string, ReadonlyArray<string>> = {
	bug: ["diagnosing-bugs", "tdd"],
	blocker: ["diagnosing-bugs"],
	feature: ["to-prd", "tdd"],
	chore: ["tdd"],
};

const handleWork = (config: {
	fresh: boolean;
	user: Option.Option<string>;
}): Effect.Effect<void, any, any> =>
	Effect.gen(function* () {
		const resolvedUser = Option.isSome(config.user) ? config.user.value : undefined;
		const result = yield* runWithFlowEnv(formatLoadingWorkSummaryMessage(), (env) =>
			Effect.gen(function* () {
				const statusResult = yield* status(env, { fresh: config.fresh });
				const mineResult = yield* mine(env, { fresh: false, user: resolvedUser });
				const nextResult = yield* nextOrStart(env, { fresh: false, autoStart: false });
				return {
					statusResult,
					mineResult,
					nextResult,
					workHealth: analyzeWorkHealth(
						statusResult.cache.cards.concat(statusResult.cache.notNow),
						env.config.skills,
					),
				};
			}),
		);

		yield* Console.log(formatWorkHeader(result.mineResult.name, result.mineResult.userId));
		yield* Console.log(
			formatWorkBoardSummary(
				result.statusResult.age,
				result.statusResult.cache.cards.length,
				result.statusResult.cache.notNow.length,
			),
		);

		yield* Console.log(formatWorkSection("current"));
		if (result.mineResult.cards.length > 0) {
			yield* Console.log(printCards(result.mineResult.cards));
		} else {
			yield* Console.log(formatNoCurrentWork());
		}

		yield* Console.log(formatWorkSection("next"));
		if (result.nextResult.card) {
			yield* Console.log(
				formatNextSummary(result.nextResult.card.number, result.nextResult.card.title),
			);
			yield* Console.log(formatNextActionHint(result.nextResult.card.number));
		} else {
			yield* Console.log(formatNoTodoCard(result.nextResult.user.name));
		}

		yield* Console.log(formatWorkSection("health"));
		yield* Console.log(formatWorkHealth(result.workHealth));

		if (result.statusResult.cache.notNow.length > 0) {
			yield* Console.log(formatNotNowSection(result.statusResult.cache.notNow.length));
			yield* Console.log(printCards(result.statusResult.cache.notNow, { systemColumn: "NOT_NOW" }));
		}
	});

const analyzeWorkHealth = (
	cards: ReadonlyArray<Card>,
	skills?: ProjectSkillsConfig,
): WorkHealth => {
	const inputsNeeded: string[] = [];
	const suggestedSkills: string[] = [];
	let tagIssues = 0;

	for (const card of cards) {
		const tags = (card.tags || []).map((tag) => tag.trim().toLowerCase());
		if (!tags.some((tag) => tag.startsWith("priority:"))) tagIssues += 1;
		if (!tags.some((tag) => tag.startsWith("type:"))) tagIssues += 1;
		for (const tag of tags) {
			if (tag.startsWith("api_status:")) {
				inputsNeeded.push(`#${card.number}: API status ${tag.slice("api_status:".length)}`);
			}
			if (tag.startsWith("skill:")) {
				suggestedSkills.push(tag.slice("skill:".length));
			}
		}

		const description = card.descriptionHtml || card.description || "";
		for (const input of extractSectionItems(description, "Inputs Needed")) {
			inputsNeeded.push(`#${card.number}: ${input}`);
		}

		for (const skill of extractSectionItems(description, "Suggested Skills")) {
			suggestedSkills.push(skill);
		}

		const type = tags.find((tag) => tag.startsWith("type:"))?.slice("type:".length);
		if (type)
			suggestedSkills.push(...(skills?.defaults[type] ?? DEFAULT_SKILLS_BY_TYPE[type] ?? []));
		for (const areaTag of tags.filter((tag) => tag.startsWith("area:"))) {
			const area = areaTag.slice("area:".length);
			if (skills?.areas[area]) suggestedSkills.push(...skills.areas[area]);
		}
	}

	return {
		tagIssues,
		inputsNeeded: unique(inputsNeeded).slice(0, 8),
		suggestedSkills: unique(suggestedSkills).slice(0, 8),
	};
};

const extractSectionItems = (description: string, heading: string): string[] => {
	const lines = description
		.replace(/<h2[^>]*>/gi, "\n## ")
		.replace(/<\/h2>/gi, "\n")
		.replace(/<li[^>]*>/gi, "\n- ")
		.replace(/<\/li>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.split(/\r?\n/);
	const items: string[] = [];
	let inSection = false;
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (/^##\s+/.test(line)) {
			inSection = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$`, "i").test(line);
			continue;
		}
		if (inSection && /^[-*]\s+/.test(line)) {
			items.push(line.replace(/^[-*]\s+/, "").trim());
		}
	}
	return items.filter(Boolean);
};

const unique = (values: ReadonlyArray<string>): string[] =>
	Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const formatWorkHealth = (health: WorkHealth): string => {
	const lines = [`tag issues: ${health.tagIssues}`];
	lines.push(`suggested skills: ${health.suggestedSkills.join(", ") || "-"}`);
	lines.push(`inputs needed: ${health.inputsNeeded.join("; ") || "-"}`);
	return lines.join("\n");
};

export const flowWorkCmd = Command.make(
	"work",
	{
		fresh: Flag.boolean("fresh").pipe(Flag.withDescription("Skip cache, fetch from API")),
		user: Argument.string("user").pipe(
			Argument.withDescription("GitHub username to summarize"),
			Argument.optional,
		),
	},
	handleWork,
).pipe(Command.withDescription("Show the daily work summary"));
