import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createCardEditDraft } from "../src/cli/flow-content";

test("createCardEditDraft reconstructs remote description, tags, and steps", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-draft-"));
	const previousCwd = process.cwd();
	const previousStateHome = process.env.XDG_STATE_HOME;
	try {
		process.chdir(root);
		process.env.XDG_STATE_HOME = join(root, "state");
		const init = Bun.spawnSync(["git", "init"], { cwd: root, stdout: "ignore", stderr: "ignore" });
		expect(init.exitCode).toBe(0);
		const result = await Effect.runPromise(
			createCardEditDraft({
				number: 436,
				title: "Refresh catalog",
				descriptionHtml: "<h2>Goal</h2><p>Refresh Shopify templates.</p>",
				tags: ["type:chore", "priority:p2"],
				steps: [
					{ id: "s1", content: "Refresh catalog", completed: true },
					{ id: "s2", content: "Verify auth", completed: false },
				],
			}),
		);
		const draft = readFileSync(result.path, "utf8");
		expect(result.path).toContain("/.git/fizzyx/drafts/");
		expect(draft).toContain("# Refresh catalog");
		expect(draft).toContain("- type:chore");
		expect(draft).toContain("## Goal\n\nRefresh Shopify templates.");
		expect(draft).toContain("- [x] Refresh catalog");
		expect(draft).toContain("- [ ] Verify auth");
	} finally {
		process.chdir(previousCwd);
		if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
		else process.env.XDG_STATE_HOME = previousStateHome;
		rmSync(root, { recursive: true, force: true });
	}
});
