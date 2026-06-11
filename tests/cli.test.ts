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

type CliResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

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

test("prints top-level grouped help", async () => {
	const { stdout, exitCode } = await runCli(["--help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx <command>");
	expect(stdout).toContain("  setup");
	expect(stdout).toContain("  auth");
	expect(stdout).toContain("  flow");
	expect(stdout).toContain("fizzyx <command> -h");
	expect(stdout).not.toContain("  sync");
	expect(stdout).not.toContain("  help");

	expect(stdout).not.toContain("--account");
	expect(stdout).not.toContain("--todo");
	expect(stdout).not.toContain("--in-progress");
	expect(stdout).not.toContain("--users");
	expect(stdout).not.toContain("--api-url");
});

test.each(["help", "-h", "--help"])("setup %s prints setup help", async (helpArg) => {
	const { stdout, stderr, exitCode } = await runCli(["setup", helpArg]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx setup <command>");
	expect(stdout).toContain("setup <board-id>");
	expect(stdout).toContain("setup --list");
	expect(stderr).toBe("");
});

test("setup help exits without creating config", async () => {
	const root = makeTempDir();
	const projectDir = join(root, "project");
	const homeDir = join(root, "home");

	try {
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(homeDir, { recursive: true });

		const result = await runCli(["setup", "help"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("fizzyx setup <command>");
		expect(result.stderr).toBe("");
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

		const api = Bun.serve({
			port: 0,
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
	const { stderr, exitCode } = await runCli(["setup"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("usage: fizzyx setup <board-id>");
});

test("prints flow help", async () => {
	const { stdout, exitCode } = await runCli(["flow", "help"]);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("fizzyx flow <command>");
	expect(stdout).toContain("add <user> <title> --desc <file|->");
});

test("top-level flow command suggests flow namespace", async () => {
	const { stderr, exitCode } = await runCli(["mine", "--help"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("unknown command: mine");
	expect(stderr).toContain("Did you mean: fizzyx flow mine?");
});

test("setup does not expose advanced flags", async () => {
	const { stderr, exitCode } = await runCli(["setup", "--todo", "id"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("usage: fizzyx setup <board-id>");
});

test("flow done requires a card number", async () => {
	const { stderr, exitCode } = await runCli(["flow", "done"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("card number is required");
});

test("flow add requires description input", async () => {
	const { stderr, exitCode } = await runCli(["flow", "add", "me", "Title"]);

	expect(exitCode).toBe(1);
	expect(stderr).toContain("fizzyx flow add <user> <title> --desc <file|->");
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

		const api = Bun.serve({
			port: 0,
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
						req.body === null
							? {}
							: ((await new Response(req.body).json()) as { column?: { name?: string } });

					return Response.json({
						data: {
							id: body.column?.name === "TODO" ? "todo-id" : "inprogress-id",
							name: body.column?.name,
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
		expect(result.stderr).toContain("flow config missing; initializing...");
		expect(result.stdout).toContain("flow configured with todo=todo-id in_progress=inprogress-id");

		const second = await runCli(["flow", "init"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(second.exitCode).toBe(0);
		expect(second.stderr).not.toContain("flow config missing; initializing...");
		expect(second.stdout).toContain("flow configured with todo=todo-id in_progress=inprogress-id");
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

		const api = Bun.serve({
			port: 0,
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
		expect(result.stderr).not.toContain("flow config missing; initializing...");
		expect(result.stdout).toContain("flow configured with todo=todo-id in_progress=inprogress-id");

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

		const api = Bun.serve({
			port: 0,
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
					const body =
						req.body === null ? {} : ((await req.json()) as { column?: { name?: string } });
					const name = typeof body.column?.name === "string" ? body.column.name : "";
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
		expect(result.stderr).toContain("flow config missing; initializing...");
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
		expect(result.stdout).toContain("account: 1");
		expect(result.stdout).toContain("authenticated: true");
		expect(result.stdout).not.toContain("official-token");

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

		const api = Bun.serve({
			port: 0,
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
		expect(result.stdout).toContain("account: 1");
		expect(result.stdout).toContain("authenticated: true");
		expect(result.stdout).toContain("user: Identity User");
		expect(result.stdout).toContain("user_id: identity-user");
		expect(result.stdout).toContain("email: identity@example.com");
		expect(result.stdout).not.toContain("identity_error");

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
		mkdirSync(projectDir, { recursive: true });
		mkdirSync(join(homeDir, ".config", "fizzy", "credentials"), {
			recursive: true,
		});
		writeFileSync(
			officialConfigPath,
			`token: official-token\naccount: 1\napi_url: https://example.com\nboard: board-1\n`,
		);
		mkdirSync(join(homeDir, ".config", "fizzyx", "credentials"), { recursive: true });
		writeFileSync(credentialsPath, JSON.stringify({ token: "local-token" }, null, 2));

		const result = await runCli(["auth", "status"], {
			cwd: projectDir,
			env: { HOME: homeDir },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("authenticated: true");

		const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
		expect(credentials).toEqual({ token: "local-token" });
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
		expect(result.stdout).toContain("authenticated: false");
		expect(result.stdout).not.toContain("official-token");
		expect(existsSync(credentialsPath)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
