import tailwind from "bun-plugin-tailwind";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const outfile = path.join(process.cwd(), "dist/main.js");
const plannerHtmlModule = path.join(process.cwd(), "src/planner/planner-html.ts");

await rm(path.dirname(outfile), { recursive: true, force: true });

const plannerHtmlResult = await Bun.build({
	entrypoints: ["./src/planner/index.html"],
	target: "browser",
	compile: true,
	minify: true,
	sourcemap: "none",
	plugins: [tailwind],
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
});

for (const log of plannerHtmlResult.logs) {
	console.error(log);
}

if (!plannerHtmlResult.success) {
	throw new Error("Failed to build planner web assets");
}

const plannerHtml = await plannerHtmlResult.outputs[0]?.text();
if (plannerHtml === undefined) {
	throw new Error("Planner web build did not emit index.html");
}

const bundledPlannerHtmlModule = `
	export const plannerRoute = new Response(${JSON.stringify(plannerHtml)}, {
		headers: {
			"cache-control": "no-store",
			"content-type": "text/html; charset=utf-8",
		},
	});
`;

const result = await Bun.build({
	entrypoints: ["./src/main.ts"],
	target: "bun",
	format: "esm",
	minify: true,
	sourcemap: "none",
	define: {
		"process.env.NODE_ENV": JSON.stringify("production"),
	},
	files: {
		"./src/planner/planner-html.ts": bundledPlannerHtmlModule,
		[plannerHtmlModule]: bundledPlannerHtmlModule,
	},
});

for (const log of result.logs) {
	console.error(log);
}

if (!result.success) {
	throw new Error("Failed to build fizzyx");
}

const mainOutput = result.outputs[0];
if (mainOutput === undefined) {
	throw new Error("Fizzyx build did not emit main.js");
}

await mkdir(path.dirname(outfile), { recursive: true });
await Bun.write(outfile, mainOutput);

for (const output of result.outputs) {
	const outputPath = output === mainOutput ? outfile : output.path;
	console.log(
		` ${path.relative(process.cwd(), outputPath)}  ${(output.size / 1024).toFixed(1)} KB`,
	);
}
