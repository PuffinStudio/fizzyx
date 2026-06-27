export type PlannerPriority = "p0" | "p1" | "p2";
export type PlannerCardType = "bug" | "feature" | "chore" | "blocker";

export interface PlannerMetadata {
	priority?: string;
	type?: string;
	owner?: string;
	deadline?: string;
	impact?: string;
	effort?: string;
	depends_on: ReadonlyArray<number>;
	blocks: ReadonlyArray<number>;
	phase?: string;
}

export interface ParsedPlannerDescription {
	metadata: PlannerMetadata;
	body: string;
	warnings: ReadonlyArray<string>;
}

export interface ParsedPlannerTags {
	priority: ReadonlyArray<PlannerPriority>;
	type: ReadonlyArray<PlannerCardType>;
	area: ReadonlyArray<string>;
	phase: ReadonlyArray<string>;
	dependsOn: ReadonlyArray<number>;
	blocks: ReadonlyArray<number>;
	other: ReadonlyArray<string>;
}

const emptyMetadata = (): PlannerMetadata => ({
	depends_on: [],
	blocks: [],
});

export const parsePlannerDescription = (description?: string): ParsedPlannerDescription => {
	const value = description || "";
	const standard = parseStandardFrontmatter(value);
	if (standard !== null) {
		return standard;
	}

	const hidden = parseHiddenCommentFrontmatter(value);
	if (hidden !== null) {
		return hidden;
	}

	return { metadata: emptyMetadata(), body: value, warnings: [] };
};

const parseStandardFrontmatter = (value: string): ParsedPlannerDescription | null => {
	if (!value.startsWith("---")) {
		return null;
	}

	const raw = value.slice(3);
	if (!raw.startsWith("\n") && !raw.startsWith("\r\n")) {
		const singleLineMatch = raw.match(/^\s*([^\n\r]+?)\s*---(?:[ \t]*\r?\n|[ \t]+|$)([\s\S]*)$/);
		if (singleLineMatch) {
			const frontmatterText = singleLineMatch[1]?.trim();
			if (!frontmatterText) {
				return null;
			}

			const parsed = parseFrontmatterPairs(frontmatterText);
			if (parsed.length === 0) {
				return null;
			}

			return {
				metadata: parsedToMetadata(parsed),
				body: (singleLineMatch[2] || "").replace(/^\r?\n/, ""),
				warnings: ["normalized single-line frontmatter format"],
			};
		}
	}

	if (!value.startsWith("---\n") && !value.startsWith("---\r\n")) {
		return null;
	}

	const closeMatch = value.slice(4).match(/\r?\n---(?:\r?\n|$)/);
	const closeIndex = closeMatch?.index === undefined ? -1 : closeMatch.index + 4;
	if (closeIndex === -1) {
		return {
			metadata: emptyMetadata(),
			body: value,
			warnings: ["frontmatter is missing closing delimiter"],
		};
	}

	const rawFrontmatter = value.slice(4, closeIndex);
	const delimiterLength = closeMatch![0].length;
	const body = value.slice(closeIndex + delimiterLength).replace(/^\r?\n/, "");
	const metadata = emptyMetadata();
	const warnings: string[] = [];

	for (const rawLine of rawFrontmatter.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator === -1) {
			warnings.push(`ignored invalid frontmatter line: ${line}`);
			continue;
		}

		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();
		const scalar = unquote(rawValue);

		if (key === "depends_on") {
			metadata.depends_on = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (key === "blocks") {
			metadata.blocks = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (isPlannerMetadataScalarKey(key)) {
			if (scalar !== "") {
				assignScalarMetadata(metadata, key, scalar);
			}
		}
	}

	return { metadata, body, warnings };
};

const parseHiddenCommentFrontmatter = (value: string): ParsedPlannerDescription | null => {
	const trimmed = value.trimStart();
	if (!trimmed.startsWith("<!--")) {
		return null;
	}

	const end = trimmed.indexOf("-->");
	if (end === -1) {
		return null;
	}

	const frontmatterText = trimmed.slice(4, end).trim();
	const body = trimmed.slice(end + 3).replace(/^\r?\n/, "");

	if (!frontmatterText) {
		return { metadata: emptyMetadata(), body, warnings: [] };
	}

	const metadata = emptyMetadata();
	const warnings: string[] = [];

	if (frontmatterText.startsWith("---")) {
		const nested = parseStandardFrontmatter(frontmatterText);
		if (!nested) {
			return { metadata: emptyMetadata(), body, warnings: [`invalid hidden frontmatter format`] };
		}

		return {
			metadata: nested.metadata,
			body,
			warnings: nested.warnings,
		};
	}

	for (const rawLine of frontmatterText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const match = line.match(/^([a-z_]+)\s*:\s*(.+)$/);
		if (!match) continue;
		const key = match[1];
		if (!key) continue;
		const rawValue = match[2]?.trim();
		if (!rawValue) {
			continue;
		}

		if (key === "depends_on") {
			metadata.depends_on = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (key === "blocks") {
			metadata.blocks = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (isPlannerMetadataScalarKey(key)) {
			const scalar = unquote(rawValue);
			if (scalar !== "") {
				assignScalarMetadata(metadata, key, scalar);
			}
		}
	}

	const hasAny =
		metadata.depends_on.length > 0 ||
		metadata.blocks.length > 0 ||
		Object.values(metadata).some((value) => typeof value === "string" && value.length > 0);
	if (!hasAny) {
		return null;
	}

	return { metadata, body, warnings };
};

interface RawFrontmatterPair {
	key: string;
	value: string;
}

const parseFrontmatterPairs = (frontmatterText: string): ReadonlyArray<RawFrontmatterPair> => {
	const pattern =
		/(?:^|\s)(priority|type|owner|deadline|impact|effort|depends_on|blocks|phase)\s*:\s*("[^"]*"|'[^']*'|\[[^\]]*\]|[^\n]+?)(?=\s+(?:priority|type|owner|deadline|impact|effort|depends_on|blocks|phase)\s*:|$)/g;
	const pairs: Array<RawFrontmatterPair> = [];
	for (const match of frontmatterText.matchAll(pattern)) {
		const key = match[1];
		const rawValue = (match[2] || "").trim();
		if (key && rawValue) {
			pairs.push({ key, value: rawValue });
		}
	}
	return pairs;
};

const parsedToMetadata = (parsed: ReadonlyArray<RawFrontmatterPair>): PlannerMetadata => {
	const metadata = emptyMetadata();
	const warnings: string[] = [];
	for (const item of parsed) {
		const key = item.key;
		const rawValue = item.value;
		if (key === "depends_on") {
			metadata.depends_on = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (key === "blocks") {
			metadata.blocks = parseNumberList(rawValue, warnings, key);
			continue;
		}

		if (isPlannerMetadataScalarKey(key)) {
			const scalar = unquote(rawValue);
			if (scalar) {
				assignScalarMetadata(metadata, key, scalar);
			}
		}
	}

	return metadata;
};

const assignScalarMetadata = (
	metadata: PlannerMetadata,
	key: keyof Omit<PlannerMetadata, "depends_on" | "blocks">,
	value: string,
): void => {
	switch (key) {
		case "priority":
			metadata.priority = value;
			return;
		case "type":
			metadata.type = value;
			return;
		case "owner":
			metadata.owner = value;
			return;
		case "deadline":
			metadata.deadline = value;
			return;
		case "impact":
			metadata.impact = value;
			return;
		case "effort":
			metadata.effort = value;
			return;
		case "phase":
			metadata.phase = value;
			return;
	}
};

export const parsePlannerTags = (tags?: ReadonlyArray<string>): ParsedPlannerTags => {
	const parsed: ParsedPlannerTags = {
		priority: [],
		type: [],
		area: [],
		phase: [],
		dependsOn: [],
		blocks: [],
		other: [],
	};

	for (const tag of tags || []) {
		const normalized = tag.trim().toLowerCase();
		if (isPlannerPriorityTag(normalized)) {
			parsed.priority = parsed.priority.concat(
				normalized.slice("priority:".length) as PlannerPriority,
			);
			continue;
		}

		if (isPlannerTypeTag(normalized)) {
			parsed.type = parsed.type.concat(normalized.slice("type:".length) as PlannerCardType);
			continue;
		}

		if (normalized.startsWith("area:") && normalized.length > "area:".length) {
			parsed.area = parsed.area.concat(normalized.slice("area:".length));
			continue;
		}

		if (normalized.startsWith("phase:") && normalized.length > "phase:".length) {
			parsed.phase = parsed.phase.concat(normalized.slice("phase:".length));
			continue;
		}

		if (normalized.startsWith("depends_on:") && normalized.length > "depends_on:".length) {
			const value = Number.parseInt(normalized.slice("depends_on:".length).replace(/^#/, ""), 10);
			if (Number.isFinite(value)) {
				parsed.dependsOn = parsed.dependsOn.concat(value);
				continue;
			}
		}

		if (normalized.startsWith("blocks:") && normalized.length > "blocks:".length) {
			const value = Number.parseInt(normalized.slice("blocks:".length).replace(/^#/, ""), 10);
			if (Number.isFinite(value)) {
				parsed.blocks = parsed.blocks.concat(value);
				continue;
			}
		}

		parsed.other = parsed.other.concat(tag);
	}

	return parsed;
};

const scalarKeys = new Set(["priority", "type", "owner", "deadline", "impact", "effort", "phase"]);

const isPlannerMetadataScalarKey = (
	key: string,
): key is keyof Omit<PlannerMetadata, "depends_on" | "blocks"> => scalarKeys.has(key);

const unquote = (value: string): string => {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1).trim();
	}

	return value.trim();
};

const parseNumberList = (value: string, warnings: string[], key: string): ReadonlyArray<number> => {
	const trimmed = value.trim();
	if (!trimmed) return [];
	const inner = trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
	const numbers: number[] = [];
	for (const entry of inner.split(",")) {
		const value = Number.parseInt(unquote(entry.trim()).replace(/^#/, ""), 10);
		if (Number.isFinite(value)) {
			numbers.push(value);
		} else if (entry.trim() !== "") {
			warnings.push(`ignored invalid ${key} reference: ${entry.trim()}`);
		}
	}
	return numbers;
};

const isPlannerPriorityTag = (tag: string): boolean =>
	tag === "priority:p0" || tag === "priority:p1" || tag === "priority:p2";

const isPlannerTypeTag = (tag: string): boolean =>
	tag === "type:bug" || tag === "type:feature" || tag === "type:chore" || tag === "type:blocker";
