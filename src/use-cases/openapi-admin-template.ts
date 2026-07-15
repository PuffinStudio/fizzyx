const TOKEN_PATTERN = /\{\{(FIZZYX_[A-Z0-9_]+)\}\}/g;

export const renderTemplate = (template: string, values: Record<string, string>): string => {
	const declared = new Set([...template.matchAll(TOKEN_PATTERN)].map((match) => match[1]));
	let output = template;
	for (const [name, value] of Object.entries(values)) {
		if (!/^FIZZYX_[A-Z0-9_]+$/.test(name)) {
			throw new Error(`invalid admin template token: ${name}`);
		}
		if (!declared.has(name)) {
			throw new Error(`unused admin template value: ${name}`);
		}
		output = output.replaceAll(`{{${name}}}`, value);
	}
	const unresolved = [...output.matchAll(TOKEN_PATTERN)].map((match) => match[1]);
	if (unresolved.length > 0) {
		throw new Error(`unresolved admin template token(s): ${[...new Set(unresolved)].join(", ")}`);
	}
	return output;
};
