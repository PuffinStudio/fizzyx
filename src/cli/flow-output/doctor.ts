import type { DoctorResult } from "../../use-cases/flow-service";

export const formatDoctorResult = (
	result: DoctorResult,
	options?: { applied?: boolean },
): string => {
	const applied = options?.applied === true;
	const lines: string[] = [];
	lines.push("=== Board Health ===");
	lines.push(`account: ${result.account}`);
	lines.push(`board: ${result.boardId}`);
	lines.push(`api: ${result.apiUrl}`);
	lines.push("");
	lines.push("API-visible columns:");
	for (const col of result.allColumns) {
		const isExpected = result.columns.some((c) => c.id === col.id);
		const status = isExpected ? "\u2713" : "\u2022";
		lines.push(`  ${status} ${col.name} (${col.id})`);
	}
	lines.push("");
	lines.push("Implicit system actions:");
	for (const action of result.systemActions) {
		lines.push(`  \u2713 ${action.name} via ${action.via} (not listed by columns API)`);
	}
	if (result.info.length > 0) {
		lines.push("");
		for (const msg of result.info) {
			lines.push(`  i ${msg}`);
		}
	}
	if (result.fixes.length > 0) {
		lines.push(`\n${applied ? "Applied fixes" : "Planned fixes"}:`);
		for (const fix of result.fixes) {
			lines.push(`  \u2022 ${fix}`);
		}

		if (!applied) {
			lines.push("\nRun `fizzyx flow doctor --apply` to apply these fixes.");
		}
	} else {
		lines.push("\nAll good!");
	}

	return lines.join("\n");
};
