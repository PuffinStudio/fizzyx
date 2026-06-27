import { expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	rmSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

const ansiEscape = String.fromCharCode(27);
const ansiCsiPattern = new RegExp(`${ansiEscape}\\[[0-9;]*[a-zA-Z]`, "g");
const ansiOscPattern = new RegExp(`${ansiEscape}\\]`, "g");
const stripAnsi = (s: string): string => s.replace(ansiCsiPattern, "").replace(ansiOscPattern, "");

const runCli = async (
	args: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<CliResult> => {
	const projectRoot = join(import.meta.dir, "..");
	const entry = join(projectRoot, "src", "main.ts");
	const proc = Bun.spawn(["bun", "run", entry, ...args], {
		cwd: options?.cwd || projectRoot,
		env: {
			...process.env,
			...options?.env,
		} as NodeJS.ProcessEnv,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { stdout, stderr, exitCode };
};

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-cli-"));

const getFreePort = (): Promise<number | null> =>
	new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.on("error", () => {
			resolve(null);
		});
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((error) => {
				if (error) resolve(null);
				else resolve(port);
			});
		});
	});

test("prints top-level grouped help", async () => {
	const { stdout, exitCode } = await runCli(["--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx");
	expect(stdout).toContain("setup");
	expect(stdout).toContain("auth");
	expect(stdout).toContain("flow");
	expect(stdout).toContain("--version");
	expect(stdout).not.toContain("sync");
	expect(stdout).not.toContain("SUBCOMMANDS\n  help");

	expect(stdout).not.toContain("--account");
	expect(stdout).not.toContain("--todo");
	expect(stdout).not.toContain("--in-progress");
	expect(stdout).not.toContain("--users");
	expect(stdout).not.toContain("--api-url");
});

test("prints version with --version flag", async () => {
	const { stdout, exitCode } = await runCli(["--version"]);
	expect(exitCode).toBe(0);
	expect(stdout).toMatch(/^fizzyx v?\d+\.\d+\.\d+/);
});

test("prints version with -v flag", async () => {
	const { stdout, exitCode } = await runCli(["-v"]);
	expect(exitCode).toBe(0);
	expect(stdout).toMatch(/^fizzyx v?\d+\.\d+\.\d+/);
});

test.each(["-h", "--help"] as const)("setup %s prints setup help", async (helpArg) => {
	const { stdout, stderr, exitCode } = await runCli(["setup", helpArg]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("setup");
	expect(stdout).toContain("BOARD_ID");
	expect(stdout).toContain("--list");
	expect(stderr).toBe("");
});

test("setup help exits without creating config", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const result = await runCli(["setup", "--help"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("setup");
		expect(result.stderr).toBe("");
		expect(existsSync(join(projectDir, ".fizzyx.yaml"))).toBe(false);
		expect(existsSync(join(projectDir, ".fizzy.yaml"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setup --list shows board id and name", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
		mkdirSync(credentialsDir, { recursive: true });
		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				if (url.pathname === "/1/boards.json" && req.method === "GET") {
					return Response.json([
						{ id: "board-1", name: "Project Board" },
						{ id: "board-2", name: "Ops Board" },
					]);
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(join(projectDir, ".fizzy.yaml"), `api_url: http://127.0.0.1:${api.port}\n`);

		const result = await runCli(["setup", "--list"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("board-1");
		expect(result.stdout).toContain("Project Board");
		expect(result.stdout).toContain("board-2");
		expect(result.stdout).toContain("Ops Board");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setup command requires board id", async () => {
	const { stdout, exitCode } = await runCli(["setup"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("usage: fizzyx setup");
});

test("prints flow help", async () => {
	const { stdout, exitCode } = await runCli(["flow", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("flow");
	expect(stdout).toContain("add");
	expect(stdout).toContain("create");
	expect(stdout).toContain("repair-markdown");
	expect(stdout).toContain("repair-metadata");
	expect(stdout).toContain("complete-steps");
	expect(stdout).toContain("standardize");
	expect(stdout).toContain("standardize-all");
	expect(stdout).toContain("template");
	expect(stdout).toContain("comment-template");
	expect(stdout).toContain("workflow");
	expect(stdout).toContain("skill");
});

test("flow comment-template requires kind", async () => {
	const { stdout, exitCode } = await runCli(["flow", "comment-template", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("comment-template");
});

test("flow comment-template prints standard English template", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "comment-template", "blocked"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toBe("blocked: <reason; owner/decision needed>\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow comment-template ignores deprecated language settings and prints English", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n  card:\n    language: en\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "comment-template", "done"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toBe("done: commit <sha>: <subject>\n");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow workflow prints process checklist", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n  card:\n    language: mixed\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "workflow"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("## Workflow");
		expect(stdout).toContain("fizzyx flow comment-template <kind>");
		expect(stdout).toContain("fizzyx flow repair-metadata");
		expect(stdout).toContain("flow done");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow skill prints english skill template", async () => {
	const { stdout, exitCode } = await runCli(["flow", "skill"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("name: fizzyx");
	expect(stdout).toContain("# fizzyx");
	expect(stdout).toContain("fizzyx flow workflow");
	expect(stdout).toContain("fizzyx flow repair-metadata");
	expect(stdout).toContain("## Context Loading");
	expect(stdout).toContain("Treat this skill as generic");
	expect(stdout).toContain("Do not infer identity from git user");
	expect(stdout).not.toContain("Youda-mini");
	expect(stdout).not.toContain("03gaf3a10zn8g6flsloi7swvi");
	expect(stdout).not.toContain("AGENTS.md 片段");
});

test("flow workflow prefers local override content", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const overridePath = join(projectDir, ".agents", "skills", "fizzyx", "WORKFLOW.md");

	try {
		mkdirSync(join(projectDir, ".agents", "skills", "fizzyx"), { recursive: true });
		writeFileSync(overridePath, "## Local Workflow\n- custom workflow\n");

		const { stdout, exitCode } = await runCli(["flow", "workflow"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("## Local Workflow");
		expect(stdout).toContain("custom workflow");
		expect(stdout).not.toContain("## Workflow / 工作流");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow template prefers local override content", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const overridePath = join(projectDir, ".agents", "skills", "fizzyx", "CARD_TEMPLATE.md");

	try {
		mkdirSync(join(projectDir, ".agents", "skills", "fizzyx"), { recursive: true });
		writeFileSync(
			overridePath,
			"## Goal\n- custom goal\n\n## Steps\n- [ ] verify local template\n",
		);

		const { stdout, exitCode } = await runCli(["flow", "template"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("## Goal");
		expect(stdout).toContain("custom goal");
		expect(stdout).toContain("- [ ] verify local template");
		expect(stdout).not.toContain("## 目标");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow skill prints local override content", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const overridePath = join(projectDir, ".agents", "skills", "fizzyx", "SKILL.md");

	try {
		mkdirSync(join(projectDir, ".agents", "skills", "fizzyx"), { recursive: true });
		writeFileSync(overridePath, "---\nname: local-fizzyx\n---\n# local\n");

		const { stdout, exitCode } = await runCli(["flow", "skill"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("name: local-fizzyx");
		expect(stdout).not.toContain("name: fizzyx");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow skill init skips existing files and overwrites with --force", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const skillPath = join(projectDir, ".agents", "skills", "fizzyx", "SKILL.md");
	const workflowPath = join(projectDir, ".agents", "skills", "fizzyx", "WORKFLOW.md");
	const templatePath = join(projectDir, ".agents", "skills", "fizzyx", "CARD_TEMPLATE.md");

	try {
		mkdirSync(join(projectDir, ".agents", "skills", "fizzyx"), { recursive: true });
		writeFileSync(skillPath, "old skill\n");
		writeFileSync(workflowPath, "old workflow\n");
		writeFileSync(templatePath, "old template\n");

		const skip = await runCli(["flow", "skill", "init"], {
			cwd: projectDir,
			env: { HOME: join(root, "home") },
		});

		expect(skip.exitCode).toBe(0);
		expect(skip.stdout).toContain("skipped: .agents/skills/fizzyx/SKILL.md");
		expect(skip.stdout).toContain("skipped: .agents/skills/fizzyx/WORKFLOW.md");
		expect(skip.stdout).toContain("skipped: .agents/skills/fizzyx/CARD_TEMPLATE.md");
		expect(readFileSync(skillPath, "utf8")).toBe("old skill\n");
		expect(readFileSync(workflowPath, "utf8")).toBe("old workflow\n");
		expect(readFileSync(templatePath, "utf8")).toBe("old template\n");

		const overwritten = await runCli(["flow", "skill", "init", "--force"], {
			cwd: projectDir,
			env: { HOME: join(root, "home") },
		});

		expect(overwritten.exitCode).toBe(0);
		expect(overwritten.stdout).toContain("overwritten: .agents/skills/fizzyx/SKILL.md");
		expect(overwritten.stdout).toContain("overwritten: .agents/skills/fizzyx/WORKFLOW.md");
		expect(overwritten.stdout).toContain("overwritten: .agents/skills/fizzyx/CARD_TEMPLATE.md");
		expect(readFileSync(skillPath, "utf8")).toContain("name: fizzyx");
		expect(readFileSync(workflowPath, "utf8")).toContain("## Workflow");
		expect(readFileSync(templatePath, "utf8")).toContain("## Goal");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow template command prints card template sections", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "template"], {
			cwd: projectDir,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("## Goal");
		expect(stdout).toContain("## Scope");
		expect(stdout).toContain("### In");
		expect(stdout).toContain("### Out");
		expect(stdout).toContain("## Notes");
		expect(stdout).toContain("## Files");
		expect(stdout).toContain("## Verification");
		expect(stdout).toContain("## Steps");
		expect(stdout).not.toContain("## References");
		expect(stdout).not.toContain("## Backup");
		expect(stdout).not.toContain("## Depends On");
		expect(stdout).toContain("Define the ticket objective in 1-2 concise sentences.");
		expect(stdout).toContain("- [ ] Replace goal + scope text with final content");
		expect(stdout).not.toContain("- [ ] `");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow template --draft creates a unique project-local draft", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n`,
		);

		const first = await runCli(["flow", "template", "--draft"], { cwd: projectDir });
		const second = await runCli(["flow", "template", "--draft"], { cwd: projectDir });

		expect(first.exitCode).toBe(0);
		expect(second.exitCode).toBe(0);
		const firstPath = first.stdout.trim();
		const secondPath = second.stdout.trim();
		expect(firstPath).toMatch(/^\.fizzyx\/card-[a-f0-9-]+\.md$/);
		expect(secondPath).toMatch(/^\.fizzyx\/card-[a-f0-9-]+\.md$/);
		expect(firstPath).not.toBe(secondPath);
		expect(readFileSync(join(projectDir, firstPath), "utf8")).toContain("## Goal");
		expect(readFileSync(join(projectDir, secondPath), "utf8")).toContain("## Steps");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow template uses English defaults when config has legacy language", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });

		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users: {}\n  wip_limit: 5\n  cache_ttl: 900\n  card:\n    language: en\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "template"], { cwd: projectDir });

		expect(exitCode).toBe(0);
		expect(stdout).toContain("## Goal");
		expect(stdout).toContain("## Scope");
		expect(stdout).toContain("### In");
		expect(stdout).toContain("### Out");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow template help is available", async () => {
	const { stdout, exitCode } = await runCli(["flow", "template", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx flow template");
});

test("flow repair-markdown help is available", async () => {
	const { stdout, exitCode } = await runCli(["flow", "repair-markdown", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("repair-markdown");
	expect(stdout).toContain("card");
});

test("flow repair-metadata help is available", async () => {
	const help = await runCli(["flow", "repair-metadata", "--help"]);
	const alias = await runCli(["flow", "repair-tags", "--help"]);

	expect(help.exitCode).toBe(0);
	expect(help.stdout).toContain("repair-metadata");
	expect(help.stdout).toContain("--apply");
	expect(alias.exitCode).toBe(0);
	expect(alias.stdout).toContain("repair-metadata");
});

test("flow complete-steps help is available", async () => {
	const { stdout, exitCode } = await runCli(["flow", "complete-steps", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("complete-steps");
	expect(stdout).toContain("card");
});

test("flow standardize help is available", async () => {
	const card = await runCli(["flow", "std", "--help"]);
	const board = await runCli(["flow", "std-all", "--help"]);
	const longCard = await runCli(["flow", "standardize", "--help"]);
	const longBoard = await runCli(["flow", "standardize-all", "--help"]);

	expect(card.exitCode).toBe(0);
	expect(card.stdout).toContain("Standardize a single card");
	expect(card.stdout).toContain("card");
	expect(board.exitCode).toBe(0);
	expect(board.stdout).toContain("Standardize all board cards");
	expect(board.stdout).toContain("card");
	expect(longCard.exitCode).toBe(0);
	expect(longCard.stdout).toContain("Standardize a single card");
	expect(longBoard.exitCode).toBe(0);
	expect(longBoard.stdout).toContain("Standardize all board cards");
});

test("top-level flow command shows top-level help", async () => {
	const { stdout, exitCode } = await runCli(["mine", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx");
});

test("top-level repair-markdown with args exits non-zero", async () => {
	const { exitCode } = await runCli(["repair-markdown", "7"]);

	expect(exitCode).toBe(1);
});

test("top-level comment-template with args exits non-zero", async () => {
	const { exitCode } = await runCli(["comment-template", "done"]);

	expect(exitCode).toBe(1);
});

test("top-level workflow exits non-zero", async () => {
	const { exitCode } = await runCli(["workflow"]);

	expect(exitCode).toBe(1);
});

test("top-level skill shows top-level help", async () => {
	const { stderr, exitCode } = await runCli(["skill"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("Unknown subcommand");
	expect(stderr).toContain("skill");
});

test("flow repair-markdown repairs card description and prints result", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	const calls: string[] = [];
	const requestBodies: Array<{ [key: string]: unknown }> = [];

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
		mkdirSync(credentialsDir, { recursive: true });
		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				calls.push(`${req.method} ${url.pathname}`);

				if (url.pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						user: {
							id: "identity-id",
							name: "Identity User",
							email: "identity@example.com",
						},
					});
				}

				if (url.pathname === "/1/cards/12" && req.method === "GET") {
					return Response.json({
						number: 12,
						title: "Repair description",
						description: "## Goal\nFix tests",
					});
				}

				if (url.pathname === "/1/cards/12" && req.method === "PATCH") {
					requestBodies.push((await new Response(req.body).json()) as { [key: string]: unknown });
					return Response.json({});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					return Response.json([]);
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json([]);
				}

				if (
					(url.pathname === "/1/boards/board-1/columns" ||
						url.pathname === "/1/boards/board-1/columns.json") &&
					req.method === "POST"
				) {
					const body =
						req.body === null ? {} : ((await new Response(req.body).json()) as { name?: string });
					const name = typeof body?.name === "string" ? body.name : "";
					return Response.json({
						data: {
							id:
								name === "TODO"
									? "todo-id"
									: name === "READY"
										? "ready-id"
										: name === "INPROGRESS"
											? "inprogress-id"
											: name === "REVIEW"
												? "review-id"
												: "column-id",
							name,
						},
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: http://127.0.0.1:${api.port}\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n`,
		);

		const result = await runCli(["flow", "repair-markdown", "12"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("repaired #12");
		expect(requestBodies).toEqual([{ description: "<h2>Goal</h2>\n<p>Fix tests</p>" }]);
		expect(calls.filter((call) => call === "GET /1/cards.json").length).toBe(3);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow complete-steps completes open steps and prints count/list", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	const updated: string[] = [];

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
		mkdirSync(credentialsDir, { recursive: true });
		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						user: {
							id: "identity-id",
							name: "Identity User",
							email: "identity@example.com",
						},
					});
				}

				if (url.pathname === "/1/cards/77" && req.method === "GET") {
					return Response.json({
						number: 77,
						title: "Complete steps",
						steps: [
							{ id: "step-1", content: "Plan", completed: true },
							{ id: "step-2", content: "Implement", completed: false },
						],
					});
				}

				if (url.pathname.startsWith("/1/cards/77/steps/") && req.method === "PATCH") {
					updated.push(url.pathname);
					return Response.json({});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					return Response.json([]);
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json([]);
				}

				if (
					(url.pathname === "/1/boards/board-1/columns" ||
						url.pathname === "/1/boards/board-1/columns.json") &&
					req.method === "POST"
				) {
					const body =
						req.body === null ? {} : ((await new Response(req.body).json()) as { name?: string });
					const name = typeof body?.name === "string" ? body.name : "";
					return Response.json({
						data: {
							id:
								name === "TODO"
									? "todo-id"
									: name === "READY"
										? "ready-id"
										: name === "INPROGRESS"
											? "inprogress-id"
											: name === "REVIEW"
												? "review-id"
												: "column-id",
							name,
						},
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: http://127.0.0.1:${api.port}\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n`,
		);

		const result = await runCli(["flow", "complete-steps", "77"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("completed 1 step for #77");
		expect(result.stdout).toContain("- Implement");
		expect(updated).toEqual(["/1/cards/77/steps/step-2"]);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setup does not expose advanced flags", async () => {
	const { stdout, exitCode } = await runCli(["setup", "--todo", "id"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("setup");
	expect(stdout).not.toContain("--todo");
});

test("flow done requires a card number", async () => {
	const { stdout, exitCode } = await runCli(["flow", "done"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("Close a card");
	expect(stdout).toContain("card");
});

test("flow add requires description input", async () => {
	const { stdout, exitCode } = await runCli(["flow", "add", "me", "Title"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("Create a new card");
});

test("flow next help documents the --start option", async () => {
	const { stdout, exitCode } = await runCli(["flow", "next", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("next");
	expect(stdout).toContain("--start");
	expect(stdout).toContain("Start the recommended card immediately");
});

test("flow init bootstraps missing flow in legacy config", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const configPath = join(projectDir, ".fizzy.yaml");
	const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");

	try {
		mkdirSync(credentialsDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });

		writeFileSync(configPath, "api_url: {API_URL}\naccount: test-account\nboard: board-1\n");
		writeFileSync(
			join(credentialsDir, "test-account.json"),
			JSON.stringify({ token: "demo-token" }, null, 2),
		);

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				if (
					(url.pathname === "/test-account/boards/board-1/columns" ||
						url.pathname === "/test-account/boards/board-1/columns.json") &&
					req.method === "GET"
				) {
					return Response.json({
						data: [],
					});
				}

				if (
					(url.pathname === "/test-account/boards/board-1/columns" ||
						url.pathname === "/test-account/boards/board-1/columns.json") &&
					req.method === "POST"
				) {
					const body =
						req.body === null ? {} : ((await new Response(req.body).json()) as { name?: string });

					return Response.json({
						data: {
							id: body.name === "TODO" ? "todo-id" : "inprogress-id",
							name: body.name,
						},
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		const apiUrl = `http://127.0.0.1:${api.port}`;
		const configText = readFileSync(configPath, "utf8").replace("{API_URL}", apiUrl);
		writeFileSync(configPath, configText);

		const result = await runCli(["flow", "init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("flow config missing; initializing...");
		expect(result.stdout).toContain("flow configured:");

		const second = await runCli(["flow", "init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(second.exitCode).toBe(0);
		expect(second.stdout).not.toContain("flow config missing; initializing...");
		expect(second.stdout).toContain("flow configured:");
		expect(readFileSync(configPath, "utf8")).toContain("flow:");
		expect(readFileSync(configPath, "utf8")).toContain("todo: todo-id");
		expect(readFileSync(configPath, "utf8")).toContain("in_progress: inprogress-id");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow init preserves existing flow users while adding identity and assignees", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const configPath = join(projectDir, ".fizzy.yaml");
	const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(credentialsDir, { recursive: true });

		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						user: {
							id: "identity-id",
							name: "Identity User",
							email: "identity@example.com",
						},
					});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					return Response.json({
						data: [
							{
								number: 11,
								title: "Task",
								assignees: [{ id: "assignee-id", name: "Task Owner" }],
							},
						],
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		const apiUrl = `http://127.0.0.1:${api.port}`;
		writeFileSync(
			configPath,
			`api_url: ${apiUrl}\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n  users:\n    existing: existing-id\n  wip_limit: 5\n  cache_ttl: 900\n`,
		);

		const result = await runCli(["flow", "init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).not.toContain("flow config missing; initializing...");
		expect(result.stdout).toContain("flow configured:");

		const configText = readFileSync(configPath, "utf8");
		expect(configText).toContain("existing: existing-id");
		expect(configText).toContain("Identity User: identity-id");
		expect(configText).toContain("Task Owner: assignee-id");
		expect(configText).not.toContain("identity_error");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow init retries when token is denied and migrates official credentials", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
	const officialConfigPath = join(homeDir, ".config", "fizzy", "config.yaml");

	const configPath = join(projectDir, ".fizzy.yaml");
	const credentialsPath = join(credentialsDir, "1.json");
	const requests: Array<{ auth: string | null; method: string; path: string }> = [];
	let columnsListCalls = 0;

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(credentialsDir, { recursive: true });
		mkdirSync(join(homeDir, ".config", "fizzy"), { recursive: true });

		writeFileSync(credentialsPath, JSON.stringify({ token: "test-token" }, null, 2));
		writeFileSync(
			officialConfigPath,
			`token: official-token\naccount: 1\napi_url: https://example.com\nboard: board-1\n`,
		);

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);
				requests.push({
					auth: req.headers.get("authorization"),
					method: req.method,
					path: url.pathname,
				});

				const isColumnsEndpoint =
					url.pathname === "/1/boards/board-1/columns" ||
					url.pathname === "/1/boards/board-1/columns.json";

				if (isColumnsEndpoint && req.method === "GET") {
					columnsListCalls += 1;
					if (columnsListCalls === 1) {
						return new Response("HTTP Token: Access denied.", {
							status: 401,
						});
					}

					return Response.json({
						data: [],
					});
				}

				if (
					isColumnsEndpoint &&
					req.method === "POST" &&
					url.pathname === "/1/boards/board-1/columns.json"
				) {
					const body = req.body === null ? {} : ((await req.json()) as { name?: string });
					const name = typeof body.name === "string" ? body.name : "";
					return Response.json({
						data: {
							id: name === "TODO" ? "todo-id" : "inprogress-id",
							name,
						},
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		const apiUrl = `http://127.0.0.1:${api.port}`;
		writeFileSync(configPath, `api_url: ${apiUrl}\naccount: 1\nboard: board-1\n`);

		const result = await runCli(["flow", "init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("flow config missing; initializing...");
		expect(requests[0]!.auth).toBe("Bearer test-token");
		expect(requests.some((request) => request.auth === "Bearer official-token")).toBe(true);
		expect(readFileSync(credentialsPath, "utf8")).toContain("official-token");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("auth status auto-migrates official credentials when missing", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const officialConfigPath = join(homeDir, ".config", "fizzy", "config.yaml");
	const credentialsPath = join(homeDir, ".config", "fizzyx", "credentials", "1.json");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(join(homeDir, ".config", "fizzy"), { recursive: true });

		writeFileSync(
			officialConfigPath,
			`token: official-token\naccount: 1\napi_url: https://example.com\nboard: board-1\n`,
		);

		const result = await runCli(["auth", "status"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(stripAnsi(result.stdout)).toContain("account: 1");
		expect(stripAnsi(result.stdout)).toContain("authenticated: true");
		expect(stripAnsi(result.stdout)).not.toContain("official-token");

		const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
		expect(credentials).toEqual({ token: "official-token" });
		const mode = statSync(credentialsPath).mode & 0o777;
		expect(mode).toBe(0o600);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("auth status prints identity details when API identity succeeds", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		mkdirSync(credentialsDir, { recursive: true });

		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				if (new URL(req.url).pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						user_id: "identity-user",
						user: {
							name: "Identity User",
							email: "identity@example.com",
						},
					});
				}
				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: http://127.0.0.1:${api.port}\naccount: 1\n`,
		);

		const result = await runCli(["auth", "status"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(stripAnsi(result.stdout)).toContain("account: 1");
		expect(stripAnsi(result.stdout)).toContain("authenticated: true");
		expect(stripAnsi(result.stdout)).toContain("user: Identity User");
		expect(stripAnsi(result.stdout)).toContain("user_id: identity-user");
		expect(stripAnsi(result.stdout)).toContain("email: identity@example.com");
		expect(stripAnsi(result.stdout)).not.toContain("identity_error");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("auth status preserves existing fizzyx credentials when official one exists", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const officialConfigPath = join(homeDir, ".config", "fizzy", "config.yaml");
	const credentialsPath = join(homeDir, ".config", "fizzyx", "credentials", "1.json");

	try {
		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				if (new URL(req.url).pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						user_id: "existing-user",
						user: { name: "Existing User", email: "existing@example.com" },
					});
				}
				return new Response("not found", { status: 404 });
			},
		});

		mkdirSync(projectDir, { recursive: true });
		mkdirSync(join(homeDir, ".config", "fizzy", "credentials"), {
			recursive: true,
		});
		writeFileSync(
			officialConfigPath,
			`token: local-token\naccount: 1\napi_url: http://127.0.0.1:${api.port}\nboard: board-1\n`,
		);
		mkdirSync(join(homeDir, ".config", "fizzyx", "credentials"), { recursive: true });
		writeFileSync(credentialsPath, JSON.stringify({ token: "local-token" }, null, 2));

		const result = await runCli(["auth", "status"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(stripAnsi(result.stdout)).toContain("authenticated: true");

		const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
		expect(credentials).toEqual({ token: "local-token" });

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("auth status does not migrate from mismatched official account", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const officialConfigPath = join(homeDir, ".config", "fizzy", "config.yaml");
	const credentialsPath = join(homeDir, ".config", "fizzyx", "credentials", "1.json");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(join(homeDir, ".config", "fizzy"), { recursive: true });

		writeFileSync(
			officialConfigPath,
			`token: official-token\naccount: other-account\napi_url: https://example.com\nboard: board-1\n`,
		);

		const result = await runCli(["auth", "status"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(stripAnsi(result.stdout)).toContain("authenticated: false");
		expect(stripAnsi(result.stdout)).not.toContain("official-token");
		expect(existsSync(credentialsPath)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("oss status --files lists pending and manifest-only files", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	try {
		mkdirSync(join(projectDir, "public"), { recursive: true });
		mkdirSync(join(projectDir, ".fizzyx"), { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		writeFileSync(
			join(projectDir, ".fizzy.yaml"),
			`api_url: https://example.com
account: "1"
board: board-1
oss:
  dev:
    endpoint: https://s3.example.com
    region: auto
  sync:
    local_dir: ./public
`,
		);
		writeFileSync(join(projectDir, "public", "fresh.txt"), "fresh");
		writeFileSync(
			join(projectDir, ".fizzyx", "oss-manifest.json"),
			JSON.stringify(
				{
					version: 1,
					localDir: join(projectDir, "public"),
					remotePrefix: "",
					lastSyncedAt: "2026-01-01T00:00:00.000Z",
					files: {
						"stale.txt": {
							key: "stale.txt",
							size: 5,
							mtimeMs: 1,
						},
					},
				},
				null,
				2,
			),
		);

		const result = await runCli(["oss", "status", "--files"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("pending uploads: 1");
		expect(result.stdout).toContain("pending deletions: 1");
		expect(result.stdout).toContain("pending upload files:");
		expect(result.stdout).toContain("  + fresh.txt");
		expect(result.stdout).toContain("manifest-only files:");
		expect(result.stdout).toContain("  - stale.txt");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
