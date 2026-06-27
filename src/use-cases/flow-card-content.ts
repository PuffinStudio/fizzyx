import type { Card } from "../domain/models";

export interface ParsedTemplateDescription {
	cardDescription: string;
	templateTags: ReadonlyArray<string>;
	templateSteps: FlowContentStep[];
}

export interface FlowContentStep {
	content: string;
	completed: boolean;
}

export interface StepUpdatePlan {
	stepId: string;
	input: {
		completed?: boolean;
		content?: string;
	};
}

export interface StandardizeCardContentPlan {
	description?: string;
	stepUpdates: StepUpdatePlan[];
	stepCreates: FlowContentStep[];
	result: {
		number: number;
		descriptionUpdated: boolean;
		stepsCreated: number;
		stepsUpdated: number;
		stepsCompleted: number;
	};
}

export const parseDoneWhen = (description: string): FlowContentStep[] =>
	parseMarkdownTaskList(description)
		.concat(parseHtmlTaskList(description))
		.filter(
			(step, index, array) => array.findIndex((next) => next.content === step.content) === index,
		);

export const normalizeStepContent = (value: string): string => {
	return decodeTextEntities(
		value
			.replace(/`([^`]+)`/g, "$1")
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/~~([^~]+)~~/g, "$1")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/__([^_]+)__/g, "$1")
			.replace(/\*([^*]+)\*/g, "$1")
			.replace(/_([^_]+)_/g, "$1")
			.trim(),
	);
};

const stripTaskListHtmlText = (value: string): string =>
	value
		.replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')/gi, (_, d1, d2) => d1 ?? d2 ?? "")
		.replace(/<img\b[^>]*>/gi, "")
		.replace(/<input[^>]*>/gi, " ")
		.replace(/<[^>]*>/g, "");

export const parseTemplateDescription = (description: string): ParsedTemplateDescription => {
	const lines = description.split(/\r?\n/);
	const cardLines: string[] = [];
	const tagLines: string[] = [];
	const templateLines: string[] = [];
	let section: "card" | "tags" | "steps" = "card";
	let sawTags = false;
	let sawTemplate = false;

	for (const line of lines) {
		if (/^##\s+Tags\s*$/i.test(line)) {
			section = "tags";
			sawTags = true;
			continue;
		}

		if (/^##\s+Steps\s*$/i.test(line)) {
			section = "steps";
			sawTemplate = true;
			continue;
		}

		if (section !== "card" && /^##\s+/.test(line)) {
			section = "card";
		}

		if (section === "steps") {
			templateLines.push(line);
		} else if (section === "tags") {
			tagLines.push(line);
		} else {
			cardLines.push(line);
		}
	}

	if (!sawTemplate && !sawTags) {
		return {
			cardDescription: description,
			templateTags: [],
			templateSteps: [],
		};
	}

	return {
		cardDescription: cardLines.join("\n").replace(/\n+$/, "").trimEnd(),
		templateTags: parseTemplateTags(tagLines.join("\n")),
		templateSteps: parseDoneWhen(templateLines.join("\n")),
	};
};

const parseTemplateTags = (value: string): ReadonlyArray<string> => {
	const tags = value
		.split(/\r?\n|,/)
		.map((line) => line.trim().replace(/^[-*]\s+/, ""))
		.filter((line) => /^[a-z_]+:[^\s]+$/i.test(line));
	return Array.from(new Set(tags.map((tag) => tag.toLowerCase())));
};

type DescriptionSections = Record<string, string[]>;

export const markdownishText = (value: string): string =>
	decodeTextEntities(
		value
			.replace(
				/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
				(_, text: string) => `\n## ${stripTaskListHtmlText(text).trim()}\n`,
			)
			.replace(
				/<li[^>]*>([\s\S]*?)<\/li>/gi,
				(_, text: string) => `\n- ${stripTaskListHtmlText(text).trim()}`,
			)
			.replace(
				/<p[^>]*>([\s\S]*?)<\/p>/gi,
				(_, text: string) => `\n${stripTaskListHtmlText(text).trim()}\n`,
			)
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<[^>]*>/g, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim(),
	);

const parseDescriptionSections = (value: string): DescriptionSections => {
	const sections: DescriptionSections = {};
	let current = "root";
	for (const rawLine of value.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		if (heading?.[1]) {
			current = normalizeHeading(heading[1]);
			sections[current] ||= [];
			continue;
		}
		sections[current] ||= [];
		sections[current]!.push(line);
	}
	return sections;
};

const normalizeHeading = (value: string): string =>
	normalizeStepContent(value)
		.toLowerCase()
		.replace(/[：:]+$/, "")
		.trim();

const firstSection = (sections: DescriptionSections, names: ReadonlyArray<string>): string => {
	for (const name of names) {
		const lines = sections[name];
		if (!lines) continue;
		const text = cleanSectionLines(lines).join("\n").trim();
		if (text) return text;
	}
	return "";
};

const cleanSectionLines = (lines: ReadonlyArray<string>): string[] =>
	lines
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^[-*]\s+/, "- "));

const buildStandardDescription = (card: Card, sections: DescriptionSections): string => {
	const labels = { goal: "Goal", files: "Files", verification: "Verification", notes: "Notes" };
	const goal = firstSection(sections, ["goal", "目标"]) || card.title;
	const inputsNeeded = mergeUniqueLines(
		firstSection(sections, ["inputs needed", "输入需求"])
			.split(/\r?\n/)
			.concat(legacyInputsFromTags(card.tags || [])),
	);
	const suggestedSkills = mergeUniqueLines(
		firstSection(sections, ["suggested skills", "推荐技能"])
			.split(/\r?\n/)
			.concat(legacySkillsFromTags(card.tags || [])),
	);
	const files = firstSection(sections, ["files", "文件"]);
	const verification = mergeUniqueLines(
		firstSection(sections, ["verification", "验证"])
			.split(/\r?\n/)
			.concat(extractVerificationLines(firstSection(sections, ["done when", "完成条件"]))),
	);
	const notes = firstSection(sections, ["notes", "备注"]);

	const parts = [`## ${labels.goal}`, "", goal.trim()];
	if (inputsNeeded.length > 0) parts.push("", "## Inputs Needed", "", ...inputsNeeded);
	if (suggestedSkills.length > 0) parts.push("", "## Suggested Skills", "", ...suggestedSkills);
	if (files) parts.push("", `## ${labels.files}`, "", files);
	if (verification.length > 0) parts.push("", `## ${labels.verification}`, "", ...verification);
	if (notes) parts.push("", `## ${labels.notes}`, "", notes);
	return parts.join("\n").trim();
};

const legacyInputsFromTags = (tags: ReadonlyArray<string>): string[] =>
	tags
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag.startsWith("api_status:"))
		.map((tag) => `- API status: ${tag.slice("api_status:".length).replace(/[-_]/g, " ")}`);

const legacySkillsFromTags = (tags: ReadonlyArray<string>): string[] =>
	tags
		.map((tag) => tag.trim().toLowerCase())
		.filter((tag) => tag.startsWith("skill:"))
		.map((tag) => `- ${tag.slice("skill:".length)}`)
		.filter((skill) => skill.length > 2);

const mergeUniqueLines = (lines: ReadonlyArray<string>): string[] => {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line || seen.has(line)) continue;
		seen.add(line);
		result.push(line.startsWith("-") ? line : `- ${line}`);
	}
	return result;
};

const extractVerificationLines = (doneWhen: string): string[] =>
	doneWhen
		.split(/\r?\n/)
		.map((line) => normalizeStepContent(line.replace(/^[-*]\s+(\[[ xX]\]\s*)?/, "")))
		.filter((line) =>
			/\b(pnpm|bun|test|check|build|screenshot|compare|lint|typecheck)\b/i.test(line),
		)
		.map((line) => `- ${line}`);

const extractStandardizeSteps = (
	source: string,
	sections: DescriptionSections,
): FlowContentStep[] => {
	const doneWhen = firstSection(sections, ["done when", "完成条件"]);
	const parsed = parseDoneWhen(source).concat(parseLooseStepLines(doneWhen));
	const seen = new Set<string>();
	return parsed.filter((step) => {
		const content = normalizeStepContent(step.content);
		if (!content || seen.has(content)) return false;
		seen.add(content);
		step.content = content;
		return true;
	});
};

const parseLooseStepLines = (value: string): FlowContentStep[] =>
	value.split(/\r?\n/).flatMap((line) => {
		const match = line.match(/^\s*[-*]\s+(?:\[([ xX])]\s*)?(.+)$/);
		if (!match?.[2]) return [];
		return [
			{ content: normalizeStepContent(match[2]), completed: match[1]?.toLowerCase() === "x" },
		];
	});

const normalizeComparableDescription = (value: string): string =>
	markdownishText(value).replace(/\s+/g, " ").trim();

const parseMarkdownTaskList = (description: string): FlowContentStep[] =>
	description.split(/\r?\n/).flatMap((line) => {
		const match = line.match(/^\s*-\s*\[([ xX])]\s*(.+)$/);
		if (!match) return [];
		const content = normalizeStepContent(match[2]!.trim());
		if (!content) return [];
		return [{ content, completed: match[1]!.toLowerCase() === "x" }];
	});

const parseHtmlTaskList = (description: string): FlowContentStep[] => {
	const matches = description.matchAll(
		/<li[^>]*class=["'][^"']*task-list-item[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi,
	);

	const steps: FlowContentStep[] = [];
	for (const match of matches) {
		const html = match[1] || "";
		const completed = /<input[^>]*\bchecked\b[^>]*>/i.test(html);
		const text = normalizeStepContent(stripTaskListHtmlText(html));
		if (!text) continue;
		steps.push({ content: text, completed });
	}

	return steps;
};

const htmlEntityMap: Record<string, string> = {
	apos: "'",
	amp: "&",
	copy: "©",
	gt: ">",
	lt: "<",
	ldquo: "“",
	rdquo: "”",
	reg: "®",
	quot: '"',
	nbsp: " ",
	trade: "™",
	hellip: "…",
	ndash: "–",
	mdash: "—",
};

const decodeTextEntities = (value: string): string =>
	value
		.replace(/&([a-zA-Z]+);/g, (match, name) => {
			if (!name) return match;
			const entity =
				name in htmlEntityMap ? htmlEntityMap[name as keyof typeof htmlEntityMap] : undefined;
			return entity ?? match;
		})
		.replace(/&#x([0-9A-Fa-f]+);/g, (match, hexCode: string | undefined) => {
			if (!hexCode) return match;
			const code = Number.parseInt(hexCode, 16);
			if (Number.isNaN(code)) return match;
			return String.fromCodePoint(code);
		})
		.replace(/&#(\d+);/g, (match, decimal: string | undefined) => {
			if (!decimal) return match;
			const code = Number.parseInt(decimal, 10);
			if (Number.isNaN(code)) return match;
			return String.fromCodePoint(code);
		});

export const convertDescription = (input: string): string => {
	const standard = extractStandardFrontmatter(input);
	if (standard) {
		return renderFizzyDescription(standard.frontmatter, standard.body);
	}

	const hidden = extractHiddenFrontmatter(input);
	if (hidden) {
		return renderFizzyDescription(hidden.frontmatter, hidden.body);
	}

	if (looksLikeMarkdownDescription(input)) {
		return Bun.markdown.html(input).trim();
	}

	return input;
};

const looksLikeMarkdownDescription = (input: string): boolean =>
	/^#{1,6}\s+\S/m.test(input) || /^\s*[-*]\s+\S/m.test(input);

const extractStandardFrontmatter = (
	input: string,
): { frontmatter: string; body: string } | undefined => {
	if (!input.startsWith("---\n") && !input.startsWith("---\r\n")) {
		return undefined;
	}

	const closeMatch = input.slice(4).match(/\r?\n---(?:\r?\n|$)/);
	if (!closeMatch || closeMatch.index === undefined) {
		return undefined;
	}

	const closeIndex = closeMatch.index + 4;
	const frontmatter = input.slice(4, closeIndex).trim();
	const body = input.slice(closeIndex + closeMatch[0].length).replace(/^\r?\n/, "");
	return { frontmatter, body };
};

const extractHiddenFrontmatter = (
	input: string,
): { frontmatter: string; body: string } | undefined => {
	const trimmed = input.trimStart();
	if (!trimmed.startsWith("<!--")) {
		return undefined;
	}

	const end = trimmed.indexOf("-->");
	if (end === -1) {
		return undefined;
	}

	const frontmatter = trimmed.slice(4, end).trim();
	const body = trimmed.slice(end + 3).replace(/^\r?\n/, "");
	return { frontmatter, body };
};

const renderFizzyDescription = (frontmatter: string, body: string): string => {
	const html = Bun.markdown.html(body).trim();
	if (!frontmatter) {
		return html;
	}

	return `<!--\n${frontmatter}\n-->\n${html}`;
};

export const planStepsFromDescription = (
	card: Pick<Card, "description" | "descriptionHtml" | "steps">,
): FlowContentStep[] => {
	const existing = new Set((card.steps || []).map((step) => step.content));
	const parsed = parseDoneWhen(card.descriptionHtml || card.description || "");
	const unique = new Set<string>();
	return parsed.filter((step) => {
		if (existing.has(step.content) || unique.has(step.content)) {
			return false;
		}
		unique.add(step.content);
		return true;
	});
};

export const planStandardizeCardContent = (card: Card): StandardizeCardContentPlan => {
	const source = card.descriptionHtml || card.description || "";
	const plain = markdownishText(source);
	const sections = parseDescriptionSections(plain);
	const nextMarkdown = buildStandardDescription(card, sections);
	const nextDescription = convertDescription(nextMarkdown);
	const currentDescription = card.descriptionHtml || card.description || "";
	const descriptionUpdated =
		normalizeComparableDescription(nextDescription) !==
		normalizeComparableDescription(currentDescription);

	const existingSteps = card.steps || [];
	const existingByContent = new Map<
		string,
		{ content: string; completed?: boolean; id?: string }
	>();
	for (const step of existingSteps) {
		existingByContent.set(normalizeStepContent(step.content), step);
	}

	const oldStepCandidates =
		existingSteps.length > 0 ? [] : extractStandardizeSteps(source, sections);
	let stepsUpdated = 0;
	let stepsCompleted = 0;
	const stepUpdates: StepUpdatePlan[] = [];

	for (const step of existingSteps) {
		const normalized = normalizeStepContent(step.content);
		const needsContentUpdate = Boolean(step.id) && normalized !== step.content;
		const needsCompletion = Boolean(step.id) && Boolean(card.closed) && !step.completed;
		if (!step.id || (!needsContentUpdate && !needsCompletion)) continue;

		stepUpdates.push({
			stepId: step.id,
			input: {
				...(needsContentUpdate ? { content: normalized } : {}),
				...(needsCompletion ? { completed: true } : {}),
			},
		});
		if (needsContentUpdate) stepsUpdated += 1;
		if (needsCompletion) stepsCompleted += 1;
	}

	const stepCreates: FlowContentStep[] = [];
	for (const candidate of oldStepCandidates) {
		const content = normalizeStepContent(candidate.content);
		if (!content || existingByContent.has(content)) continue;
		stepCreates.push({
			content,
			completed: Boolean(card.closed) || candidate.completed,
		});
		existingByContent.set(content, {
			content,
			completed: Boolean(card.closed) || candidate.completed,
		});
	}

	return {
		description: descriptionUpdated ? nextDescription : undefined,
		stepUpdates,
		stepCreates,
		result: {
			number: card.number,
			descriptionUpdated,
			stepsCreated: stepCreates.length,
			stepsUpdated,
			stepsCompleted,
		},
	};
};
