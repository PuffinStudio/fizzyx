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
	expect(stdout).toContain("init");
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

test.each(["-h", "--help"] as const)("init %s prints init help", async (helpArg) => {
	const { stdout, stderr, exitCode } = await runCli(["init", helpArg]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("init");
	expect(stdout).toContain("BOARD_ID");
	expect(stdout).toContain("--list");
	expect(stderr).toBe("");
});

test("init help exits without creating config", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const result = await runCli(["init", "--help"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("init");
		expect(result.stderr).toBe("");
		expect(existsSync(join(projectDir, ".fizzyx.yaml"))).toBe(false);
		expect(existsSync(join(projectDir, ".fizzy.yaml"))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("init --list shows board id and name", async () => {
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

		const result = await runCli(["init", "--list"], {
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

test("init command requires board id when no project config exists", async () => {
	const root = makeTempDir();

	try {
		const { stdout, exitCode } = await runCli(["init"], { cwd: root });

		expect(exitCode).toBe(0);
		expect(stdout).toContain("usage: fizzyx init");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("prints flow help", async () => {
	const { stdout, exitCode } = await runCli(["flow", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("flow");
	expect(stdout).toContain("work");
	expect(stdout).toContain("list");
	expect(stdout).toContain("search");
	expect(stdout).toContain("columns");
	expect(stdout).toContain("create");
	expect(stdout).toContain("assign");
	expect(stdout).toContain("comment");
	expect(stdout).toContain("show");
	expect(stdout).toContain("move");
	expect(stdout).toContain("start");
	expect(stdout).toContain("review");
	expect(stdout).toContain("done");
	expect(stdout).toContain("reopen");
	expect(stdout).toContain("block");
	expect(stdout).toContain("unblock");
	expect(stdout).toContain("untriage");
	expect(stdout).toContain("improve");
	expect(stdout).toContain("doctor");
	expect(stdout).toContain("repair");
	expect(stdout).not.toContain("mine");
	expect(stdout).not.toContain("status");
	expect(stdout).not.toContain("ready");
	expect(stdout).not.toContain("complete-steps");
	expect(stdout).not.toContain("repair-markdown");
	expect(stdout).not.toContain("repair-metadata");
	expect(stdout).not.toContain("standardize, std");
	expect(stdout).not.toContain("standardize-all");
	expect(stdout).not.toContain("\n  workflow");
	expect(stdout).not.toContain("\n  template");
	expect(stdout).not.toContain("\n  skill");
	expect(stdout).not.toContain("comment-template");
	expect(stdout).not.toContain("\n  init");
});

test("high-frequency flow commands expose structured JSON output", async () => {
	for (const command of ["work", "list", "search", "columns", "show", "move"] as const) {
		const { stdout, exitCode } = await runCli(["flow", command, "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("--json");
	}
});

test("planner --help lists planner commands", async () => {
	const { stdout, exitCode } = await runCli(["planner", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("start");
	expect(stdout).toContain("snapshot");
	expect(stdout).not.toContain("chat-config");
	expect(stdout).not.toContain("health");
	expect(stdout).not.toContain("repair-metadata");
	expect(stdout).not.toContain("auto-fix");
});

test("planner snapshot --help has no auto-fix metadata options", async () => {
	const { stdout, exitCode } = await runCli(["planner", "snapshot", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("snapshot");
	expect(stdout).not.toContain("--auto-fix");
	expect(stdout).not.toContain("--default-priority");
	expect(stdout).not.toContain("--default-type");
});

test("flow comment-template is removed from public flow surface", async () => {
	const { stdout, exitCode } = await runCli(["flow", "comment-template", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).not.toContain("comment-template");
});

test("flow comment supports editing an existing comment", async () => {
	const { stdout, exitCode } = await runCli(["flow", "comment", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("--edit");
	expect(stdout).toContain("comment id");
});

test("flow repair supports kind-based help surface", async () => {
	const steps = await runCli(["flow", "repair", "--kind", "steps", "--help"]);
	const metadata = await runCli(["flow", "repair", "--kind", "metadata", "--help"]);
	const all = await runCli(["flow", "repair", "--all", "--help"]);

	expect(steps.exitCode).toBe(0);
	expect(steps.stdout).toContain("fizzyx flow repair");
	expect(steps.stdout).toContain("--kind");
	expect(steps.stdout).toContain("steps");

	expect(metadata.exitCode).toBe(0);
	expect(metadata.stdout).toContain("metadata");
	expect(metadata.stdout).toContain("--apply");

	expect(all.exitCode).toBe(0);
	expect(all.stdout).toContain("--all");
	expect(all.stdout).toContain("repair");
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
	const { stdout, stderr, exitCode } = await runCli(["skill"]);

	expect(exitCode).toBe(1);
	expect(`${stdout}${stderr}`).toContain("skill");
});

test("flow done --complete-steps completes open steps before closing card", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	const updated: string[] = [];
	const comments: Array<{ card: string; body: string }> = [];
	const closed: string[] = [];

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

				if (url.pathname === "/1/cards/77/comments.json" && req.method === "POST") {
					comments.push({
						card: "77",
						body: String((await req.json()).body ?? ""),
					});
					return Response.json({});
				}

				if (url.pathname === "/1/cards/77/closure.json" && req.method === "POST") {
					closed.push(url.pathname);
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

		const result = await runCli(["flow", "done", "77", "--complete-steps", "commit abc: done"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("completed 1 step for #77");
		expect(result.stdout).toContain("- Implement");
		expect(result.stdout).toContain("closed #77 (commit abc: done)");
		expect(updated).toEqual(["/1/cards/77/steps/step-2"]);
		expect(closed).toEqual(["/1/cards/77/closure.json"]);
		expect(comments).toEqual([{ card: "77", body: "<p>done: commit abc: done</p>" }]);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("init does not expose advanced flags", async () => {
	const { stdout, exitCode } = await runCli(["init", "--todo", "id"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("init");
	expect(stdout).not.toContain("--todo");
});

test("flow done requires a card number", async () => {
	const { stdout, exitCode } = await runCli(["flow", "done"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("Close a card");
	expect(stdout).toContain("card");
});

test("flow create requires description input", async () => {
	const { stdout, exitCode } = await runCli(["flow", "create", "Title"]);

	expect(exitCode).toBe(1);
	expect(stdout).toContain("usage: fizzyx flow create");
});

test("flow edit exposes title and description options", async () => {
	const { stdout, exitCode } = await runCli(["flow", "edit", "--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("Edit a card title or description");
	expect(stdout).toContain("--title");
	expect(stdout).toContain("--desc");
	expect(stdout).toContain("--draft");
});

test("flow create --draft writes a local card draft", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, ".fizzyx.yaml"), `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(["flow", "create", "--draft"], {
			cwd: projectDir,
			env: { XDG_STATE_HOME: join(root, "state") },
		});
		const draftPath = stdout.trim();
		const draft = readFileSync(draftPath, "utf8");

		expect(exitCode).toBe(0);
		expect(draftPath).toContain("/fizzyx/drafts/");
		expect(draftPath).toMatch(/card-.+\.md$/);
		expect(draft).toContain("## Suggested Skills");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow create --draft pre-fills title, assignee, and requested skills", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");

	try {
		mkdirSync(projectDir, { recursive: true });
		writeFileSync(join(projectDir, ".fizzyx.yaml"), `api_url: https://example.com\n`);

		const { stdout, exitCode } = await runCli(
			[
				"flow",
				"create",
				"测试卡-勿动",
				"--draft",
				"--assign",
				"Ellen",
				"--skill",
				"diagnosing-bugs",
			],
			{
				cwd: projectDir,
				env: { XDG_STATE_HOME: join(root, "state") },
			},
		);
		const draftPath = stdout.trim();
		const draft = readFileSync(draftPath, "utf8");

		expect(exitCode).toBe(0);
		expect(draftPath).toContain("/fizzyx/drafts/");
		expect(draftPath).toMatch(/card-.+\.md$/);
		expect(draft).toContain("# 测试卡-勿动");
		expect(draft).toContain("## Assignee\n- Ellen");
		expect(draft).toContain("## Suggested Skills\n- diagnosing-bugs");
		expect(draft).not.toContain("- tdd\n\n## Plan");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow create without --assign leaves card unassigned", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const assignmentBodies: unknown[] = [];

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
		mkdirSync(credentialsDir, { recursive: true });
		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const draftPath = join(projectDir, ".fizzyx", "card-create.md");
		mkdirSync(join(projectDir, ".fizzyx"), { recursive: true });
		writeFileSync(
			draftPath,
			`## Goal
Create a card with the current user.

## Steps
- [ ] Implement`,
		);

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						data: {
							user: { id: "identity-id", name: "Identity User", email: "identity@example.com" },
						},
					});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					return Response.json({ data: [] });
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json({ data: [{ id: "todo-id", name: "TODO" }] });
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "POST") {
					const body = req.body === null ? {} : ((await req.json()) as { name?: string });
					return Response.json({ data: { id: `${body.name ?? "column"}-id`, name: body.name } });
				}

				if (url.pathname === "/1/cards.json" && req.method === "POST") {
					return Response.json({
						data: {
							number: 777,
							title: "Title only",
							description: "created",
						},
					});
				}

				if (url.pathname === "/1/cards/777/triage.json" && req.method === "POST") {
					return Response.json({});
				}

				if (url.pathname === "/1/cards/777/assignments.json" && req.method === "POST") {
					assignmentBodies.push(await req.json());
					return Response.json({});
				}

				if (url.pathname === "/1/cards/777" && req.method === "GET") {
					return Response.json({
						data: {
							number: 777,
							title: "Title only",
							column: { id: "todo-id", name: "TODO" },
						},
					});
				}

				if (url.pathname === "/1/cards/777/steps.json" && req.method === "POST") {
					return Response.json({});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzyx.yaml"),
			`api_url: http://127.0.0.1:${api.port}
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users:
    Ray: ray-id
`,
		);

		const { stdout, exitCode } = await runCli(
			["flow", "create", "Title only", "--desc", ".fizzyx/card-create.md"],
			{
				cwd: projectDir,
				env: { HOME: homeDir },
			},
		);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("777");
		expect(assignmentBodies).toEqual([]);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow create with --assign assigns the requested user", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const assignmentBodies: unknown[] = [];

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });
		const credentialsDir = join(homeDir, ".config", "fizzyx", "credentials");
		mkdirSync(credentialsDir, { recursive: true });
		writeFileSync(join(credentialsDir, "1.json"), JSON.stringify({ token: "demo-token" }, null, 2));

		const draftPath = join(projectDir, ".fizzyx", "card-create.md");
		mkdirSync(join(projectDir, ".fizzyx"), { recursive: true });
		writeFileSync(
			draftPath,
			`## Goal
Create a card assigned to Ray.

## Steps
- [ ] Implement`,
		);

		const port = await getFreePort();
		if (port === null) return;

		const api = Bun.serve({
			port,
			hostname: "127.0.0.1",
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/my/identity.json" && req.method === "GET") {
					return Response.json({
						data: {
							user: { id: "identity-id", name: "Identity User", email: "identity@example.com" },
						},
					});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					return Response.json({ data: [] });
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json({ data: [{ id: "todo-id", name: "TODO" }] });
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "POST") {
					const body = req.body === null ? {} : ((await req.json()) as { name?: string });
					return Response.json({ data: { id: `${body.name ?? "column"}-id`, name: body.name } });
				}

				if (url.pathname === "/1/cards.json" && req.method === "POST") {
					return Response.json({
						data: {
							number: 778,
							title: "Assigned title",
							description: "created",
						},
					});
				}

				if (url.pathname === "/1/cards/778/triage.json" && req.method === "POST") {
					return Response.json({});
				}

				if (url.pathname === "/1/cards/778/assignments.json" && req.method === "POST") {
					assignmentBodies.push(await req.json());
					return Response.json({});
				}

				if (url.pathname === "/1/cards/778" && req.method === "GET") {
					return Response.json({
						data: {
							number: 778,
							title: "Assigned title",
							column: { id: "todo-id", name: "TODO" },
						},
					});
				}

				if (url.pathname === "/1/cards/778/steps.json" && req.method === "POST") {
					return Response.json({});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzyx.yaml"),
			`api_url: http://127.0.0.1:${api.port}
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users:
    Ray: ray-id
`,
		);

		const { stdout, exitCode } = await runCli(
			["flow", "create", "Assigned title", "--assign", "Ray", "--desc", ".fizzyx/card-create.md"],
			{
				cwd: projectDir,
				env: { HOME: homeDir },
			},
		);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("778");
		expect(assignmentBodies).toEqual([{ assignee_id: "ray-id" }]);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow assign assigns an existing card to an explicit user", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");
	const assignmentBodies: unknown[] = [];

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
						data: {
							user: { id: "identity-id", name: "Identity User", email: "identity@example.com" },
						},
					});
				}

				if (url.pathname === "/1/cards.json" && req.method === "GET") {
					const indexedBy = url.searchParams.get("indexed_by");
					return Response.json({
						data:
							indexedBy === "not_now"
								? []
								: [
										{
											number: 23,
											title: "Assign target",
											assignees: [],
										},
									],
					});
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json({ data: [{ id: "todo-id", name: "TODO" }] });
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "POST") {
					const body = req.body === null ? {} : ((await req.json()) as { name?: string });
					return Response.json({ data: { id: `${body.name ?? "column"}-id`, name: body.name } });
				}

				if (url.pathname === "/1/cards/23/assignments.json" && req.method === "POST") {
					assignmentBodies.push(await req.json());
					return Response.json({});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzyx.yaml"),
			`api_url: http://127.0.0.1:${api.port}
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users:
    Ray: ray-id
`,
		);

		const { stdout, exitCode } = await runCli(["flow", "assign", "23", "Ray"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("assigned #23 to Ray");
		expect(assignmentBodies).toEqual([{ assignee_id: "ray-id" }]);

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("flow work suggests default skills from card type without skill config", async () => {
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
					if (url.searchParams.get("indexed_by") === "not_now") {
						return Response.json({ data: [] });
					}
					return Response.json({
						data: [
							{
								number: 42,
								title: "Fix crash",
								tags: ["priority:p1", "type:bug"],
								column: { id: "todo-id", name: "READY" },
								assignees: [{ id: "identity-id", name: "Identity User" }],
							},
						],
					});
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "GET") {
					return Response.json({
						data: [
							{ id: "todo-id", name: "READY" },
							{ id: "inprogress-id", name: "IN PROGRESS" },
						],
					});
				}

				if (url.pathname === "/1/boards/board-1/columns.json" && req.method === "POST") {
					const body =
						req.body === null ? {} : ((await new Response(req.body).json()) as { name?: string });
					return Response.json({
						data: {
							id: `${body.name ?? "column"}-id`,
							name: body.name,
						},
					});
				}

				return new Response("not found", { status: 404 });
			},
		});

		writeFileSync(
			join(projectDir, ".fizzyx.yaml"),
			`api_url: http://127.0.0.1:${api.port}\naccount: 1\nboard: board-1\nflow:\n  columns:\n    todo: todo-id\n    in_progress: inprogress-id\n`,
		);

		const { stdout, exitCode } = await runCli(["flow", "work", "--fresh"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("git guardrail: fizzyx dev status --agent");
		expect(stdout).toContain("suggested skills: dev-workflow, diagnosing-bugs, tdd");
		expect(stdout).toContain("coding-standards");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("init bootstraps missing flow in legacy config", async () => {
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

		const result = await runCli(["init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("flow config missing; initializing...");
		expect(result.stdout).toContain("flow configured:");
		expect(result.stdout).toContain("AGENTS.md created:");
		const agentsPath = join(projectDir, "AGENTS.md");
		expect(readFileSync(agentsPath, "utf8")).toContain("fizzyx dev status --agent");
		writeFileSync(agentsPath, `# Existing project rules\n\n${readFileSync(agentsPath, "utf8")}`);

		const second = await runCli(["init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(second.exitCode).toBe(0);
		expect(second.stdout).not.toContain("flow config missing; initializing...");
		expect(second.stdout).toContain("flow configured:");
		expect(second.stdout).toContain("AGENTS.md unchanged:");
		expect(readFileSync(agentsPath, "utf8")).toStartWith("# Existing project rules\n\n");
		expect(
			readFileSync(join(projectDir, "AGENTS.md"), "utf8").match(
				/<!-- fizzyx:dev-workflow:start -->/g,
			),
		).toHaveLength(1);
		expect(readFileSync(configPath, "utf8")).toContain("flow:");
		expect(readFileSync(configPath, "utf8")).toContain("todo: todo-id");
		expect(readFileSync(configPath, "utf8")).toContain("in_progress: inprogress-id");

		api.stop();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("init preserves existing flow users while adding identity and assignees", async () => {
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

		const result = await runCli(["init"], {
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

test("init retries when token is denied and migrates official credentials", async () => {
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

		const result = await runCli(["init"], {
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
