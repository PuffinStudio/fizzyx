# HTML Report Format

Write one self-contained HTML report to the OS temp directory. Load Tailwind from `https://cdn.tailwindcss.com` and Mermaid 11 from jsDelivr. The report must contain a compact legend, one before/after visual per candidate, file references, problem, solution, short wins, and one top recommendation.

Use a lean editorial layout with stone/slate neutrals, emerald for recommendations, amber for cautions, and red only for leakage. Mix Mermaid graphs with hand-built boxes, mass diagrams, and cross-sections. Keep each visual understandable without explanatory paragraphs.

Use the architecture vocabulary exactly: module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality. Candidate badges are `Strong`, `Worth exploring`, or `Speculative`. Open the report after writing it and ask which candidate the user wants to explore.

Minimal scaffold:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>Architecture review</title>
		<script src="https://cdn.tailwindcss.com"></script>
		<script type="module">
			import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
			mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
		</script>
	</head>
	<body class="bg-stone-50 text-slate-900">
		<main class="mx-auto max-w-5xl space-y-12 px-6 py-12">
			<header><!-- repo, date, legend --></header>
			<section><!-- candidate articles --></section>
			<section><!-- top recommendation --></section>
		</main>
	</body>
</html>
```
