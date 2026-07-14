export type FlowBreadcrumb = {
	action: string;
	cmd: string;
	description: string;
};

export const flowJson = (
	data: unknown,
	summary: string,
	breadcrumbs: ReadonlyArray<FlowBreadcrumb> = [],
): string =>
	JSON.stringify(
		{
			ok: true,
			data,
			summary,
			...(breadcrumbs.length > 0 ? { breadcrumbs } : {}),
		},
		null,
		2,
	);
