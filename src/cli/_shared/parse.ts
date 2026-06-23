export const parseFlag = (args: ReadonlyArray<string>, name: string): string | undefined => {
	const index = args.indexOf(name);
	if (index < 0 || !args[index + 1]) {
		return undefined;
	}
	return args[index + 1];
};

export const parseFlags = (args: ReadonlyArray<string>, name: string): string[] => {
	const results: string[] = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === name && args[i + 1]) {
			results.push(args[i + 1]!);
			i++;
		}
	}
	return results;
};

export const firstNonFlag = (args: ReadonlyArray<string>): string | undefined =>
	args.find((arg) => !arg.startsWith("--"));

export const parseNumber = (value: string | undefined): number => {
	const parsed = Number.parseInt((value || "").replace(/^#/, ""), 10);
	if (!Number.isFinite(parsed)) throw new Error("card number is required");
	return parsed;
};
