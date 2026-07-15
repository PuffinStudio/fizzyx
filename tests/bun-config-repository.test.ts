import { expect, test, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { makeBunConfigRepository } from "../src/adapters/bun-config-repository";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "fizzyx-repo-"));

test("setupProjectConfig renders empty users map inline", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("users: ");
		expect(text).toContain("{}");
		expect(text).toContain("board: board-1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig writes non-empty users object", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {
					Alice: "alice-id",
					Bob: "bob-id",
				},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("Alice: alice-id");
		expect(text).toContain("Bob: bob-id");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig writes flow section without card language", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).not.toContain("card:");
		expect(text).toContain("wip_limit: 5");
		expect(text).toContain("cache_ttl: 900");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig preserves custom flow settings", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();

	try {
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  wip_limit: 10
  cache_ttl: 1200
`,
		);

		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("wip_limit: 10");
		expect(text).toContain("cache_ttl: 1200");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig applies flow defaults when card language fields are absent", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);

		const text = `api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
`;
		writeFileSync(configPath, text);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.flow).toBeDefined();
		expect(config.flow!.wipLimit).toBe(5);
		expect(config.flow!.cacheTtlSeconds).toBe(900);
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig ignores invalid legacy flow.card.language values", async () => {
	const root = mkdtempSync(join(tmpdir(), "fizzyx-repo-"));
	const configPath = join(root, ".fizzy.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);

		const text = `api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  card:
    language: jp
`;
		writeFileSync(configPath, text);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.flow).toBeDefined();
		expect(config.flow!.wipLimit).toBe(5);
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig parses flow tag vocabularies", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  tags:
    areas:
      - flow
      - auth
    phases:
      - discovery
      - polish
`,
		);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.flow?.tags).toEqual({
			areas: ["flow", "auth"],
			phases: ["discovery", "polish"],
		});
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig preserves flow tag vocabularies", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();

	try {
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
  tags:
    areas:
      - flow
      - auth
    phases:
      - discovery
      - polish
`,
		);

		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("tags:");
		expect(text).toContain("areas:");
		expect(text).toContain("- flow");
		expect(text).toContain("- auth");
		expect(text).toContain("phases:");
		expect(text).toContain("- discovery");
		expect(text).toContain("- polish");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig parses project skills config", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
    improve-codebase:
      source: builtin
      version: 1.0.0
  defaults:
    feature:
      - tdd
      - codebase-design
    bug:
      - diagnosing-bugs
      - tdd
  areas:
    auth:
      - security-review
`,
		);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.skills).toEqual({
			version: 1,
			sources: {},
			installed: {
				tdd: {
					source: "builtin",
					version: "1.0.0",
				},
				"improve-codebase": {
					source: "builtin",
					version: "1.0.0",
				},
			},
			defaults: {
				feature: ["tdd", "codebase-design"],
				bug: ["diagnosing-bugs", "tdd"],
			},
			areas: {
				auth: ["security-review"],
			},
		});
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig parses optional OpenAPI admin defaults and auth override", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`openapi:
  admin:
    input: ./openapi.yaml
    output: ./apps/admin
    framework: nextjs
    auth:
      mode: server-cookie
      login_operation_id: authLogin
      username_field: email
      password_field: password
      access_token_path: data.access_token
      routes:
        login: /login
        after_login: /users
`,
		);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.openapi?.admin).toEqual({
			input: "./openapi.yaml",
			output: "./apps/admin",
			framework: "nextjs",
			auth: {
				mode: "server-cookie",
				loginOperationId: "authLogin",
				usernameField: "email",
				passwordField: "password",
				accessTokenPath: "data.access_token",
				routes: { login: "/login", afterLogin: "/users" },
			},
		});
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig preserves project skills config", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
skills:
  version: 1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
  defaults:
    feature:
      - tdd
  areas:
    auth:
      - security-review
`,
		);

		const config = await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(config.skills).toEqual({
			version: 1,
			sources: {},
			installed: {
				tdd: {
					source: "builtin",
					version: "1.0.0",
				},
			},
			defaults: {
				feature: ["tdd"],
			},
			areas: {
				auth: ["security-review"],
			},
		});
		expect(text).toContain("skills:");
		expect(text).toContain("version: 1");
		expect(text).toContain("installed:");
		expect(text).toContain("source: builtin");
		expect(text).toContain("defaults:");
		expect(text).toContain("feature:");
		expect(text).toContain("areas:");
		expect(text).toContain("auth:");
		expect(text).toContain("- security-review");
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("loadProjectConfig parses dev workflow config block", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
dev:
  production_branch: main
  default_base: main
  sync_strategy: rebase
  protected_branches:
    - main
    - master
    - production
  environment_branches:
    dev:
      deploys_to: development
      aggregate: true
  branch_prefixes:
    feature: feature
    fix: fix
    hotfix: hotfix
    ops: ops
    chore: chore
    docs: docs
    maintenance: maintenance
  checks:
    ready:
      - bun --bun run check
    hotfix:
      - bun --bun run check
  promotion:
    strategy: pr
    allow_direct_production_merge: false
    block_environment_to_production: true
    require_confirm_production: true
    require_ready_for_production: true
  stale_after_days: 7
  commit:
    conventional: true
  branches:
    feature/card-123-payment-coupon:
      card: 123
      kind: feature
      base: main
      created_at: "2026-07-07T00:00:00Z"
`,
		);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.dev).toMatchObject({
			productionBranch: "main",
			defaultBase: "main",
			syncStrategy: "rebase",
			protectedBranches: ["main", "master", "production"],
			environmentBranches: {
				dev: {
					deploysTo: "development",
					aggregate: true,
				},
			},
			branchPrefixes: {
				feature: "feature",
				fix: "fix",
				hotfix: "hotfix",
				ops: "ops",
				chore: "chore",
				docs: "docs",
				maintenance: "maintenance",
			},
			checks: {
				ready: ["bun --bun run check"],
				hotfix: ["bun --bun run check"],
			},
			promotion: {
				strategy: "pr",
				blockEnvironmentToProduction: true,
				requireConfirmProduction: true,
				requireReadyForProduction: true,
			},
			staleAfterDays: 7,
			commit: {
				conventional: true,
			},
			branches: {
				"feature/card-123-payment-coupon": {
					card: 123,
					kind: "feature",
					base: "main",
					createdAt: "2026-07-07T00:00:00Z",
				},
			},
		});
		expect(config.dev?.promotion?.allowDirectProductionMerge).toBeUndefined();
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig preserves existing dev config block", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
dev:
  production_branch: main
  promotion:
    strategy: merge
    allow_direct_production_merge: true
`,
		);

		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("dev:");
		expect(text).toContain("production_branch: main");
		expect(text).toContain("promotion:");
		expect(text).toContain("strategy: merge");
		expect(text).toContain("allow_direct_production_merge: true");

		const config = await Effect.runPromise(repo.loadProjectConfig());
		expect(config.dev?.promotion?.strategy).toBe("merge");
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

test("setupProjectConfig renders dev config block from input", async () => {
	const root = makeTempDir();
	const configPath = join(root, ".fizzyx.yaml");
	const repo = makeBunConfigRepository();
	const originalCwd = process.cwd();

	try {
		process.chdir(root);
		writeFileSync(
			configPath,
			`api_url: https://example.com
account: 1
board: board-1
flow:
  columns:
    todo: todo-id
    in_progress: inprogress-id
  users: {}
`,
		);

		await Effect.runPromise(
			repo.setupProjectConfig({
				account: "1",
				board: "board-1",
				todoColumn: "todo-id",
				inProgressColumn: "inprogress-id",
				users: {},
				apiUrl: "https://example.com",
				configPath,
				dev: {
					productionBranch: "main",
					defaultBase: "main",
					syncStrategy: "rebase",
					protectedBranches: ["main", "master", "production"],
					environmentBranches: {
						dev: {
							deploysTo: "development",
							aggregate: true,
						},
					},
					branchPrefixes: {
						feature: "feature",
						fix: "fix",
						hotfix: "hotfix",
						ops: "ops",
						chore: "chore",
						docs: "docs",
						maintenance: "maintenance",
					},
					checks: {
						ready: ["bun --bun run check"],
						hotfix: ["bun --bun run check --hotfix"],
					},
					promotion: {
						strategy: "pr",
						allowDirectProductionMerge: true,
						blockEnvironmentToProduction: true,
						requireConfirmProduction: true,
						requireReadyForProduction: true,
					},
					staleAfterDays: 30,
					commit: {
						conventional: true,
						allowWipOnReady: true,
					},
					branches: {
						"feature/card-42-order-ui": {
							card: 42,
							kind: "feature",
							base: "main",
							createdAt: "2026-07-07T12:00:00Z",
						},
					},
				},
			}),
		);

		const text = await Bun.file(configPath).text();
		expect(text).toContain("dev:");
		expect(text).toContain("production_branch: main");
		expect(text).toContain("default_base: main");
		expect(text).toContain("sync_strategy: rebase");
		expect(text).toContain("protected_branches:");
		expect(text).toContain("- main");
		expect(text).toContain("deploys_to: development");
		expect(text).toContain("aggregate: true");
		expect(text).toContain("branch_prefixes:");
		expect(text).toContain("feature: feature");
		expect(text).toContain("checks:");
		expect(text).toContain("ready:");
		expect(text).toContain("bun --bun run check");
		expect(text).toContain("promotion:");
		expect(text).toContain("strategy: pr");
		expect(text).toContain("allow_direct_production_merge: true");
		expect(text).toContain("block_environment_to_production: true");
		expect(text).toContain("require_confirm_production: true");
		expect(text).toContain("require_ready_for_production: true");
		expect(text).toContain("stale_after_days: 30");
		expect(text).toContain("conventional: true");
		expect(text).toContain("allow_wip_on_ready: true");
		expect(text).not.toContain("feature/card-42-order-ui:");

		const config = await Effect.runPromise(repo.loadProjectConfig());
		expect(config.dev?.syncStrategy).toBe("rebase");
		expect(config.dev?.promotion?.strategy).toBe("pr");
		expect(config.dev?.commit?.allowWipOnReady).toBe(true);
		expect(config.dev?.branches).toBeUndefined();
	} finally {
		process.chdir(originalCwd);
		rmSync(root, { recursive: true, force: true });
	}
});

describe("OSS config", () => {
	test("setupOssConfig writes non-sensitive config without credentials", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-oss-"));
		const configPath = join(root, ".fizzy.yaml");
		const repo = makeBunConfigRepository();

		try {
			writeFileSync(
				configPath,
				`api_url: https://example.com
account: 1
board: board-1
oss:
  prod:
    endpoint: https://s3.prod.example.com
    region: us-east-1
    bucket: myapp-prod
  sync:
    local_dir: public
    remote_prefix: assets
`,
			);

			await Effect.runPromise(
				repo.setupOssConfig({
					env: "dev",
					config: {
						endpoint: "https://s3.dev.example.com",
						region: "auto",
						bucket: "myapp-dev",
					},
					sync: {
						localDir: "public/images",
						remotePrefix: "images",
						concurrency: 10,
					},
					configPath,
				}),
			);

			const text = await Bun.file(configPath).text();
			expect(text).toContain("endpoint: https://s3.dev.example.com");
			expect(text).toContain("region: auto");
			expect(text).toContain("bucket: myapp-dev");
			expect(text).toContain("local_dir: public/images");
			expect(text).toContain("remote_prefix: images");
			expect(text).not.toContain("access_key_id");
			expect(text).not.toContain("secret_access_key");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("setupOssConfig merges with existing oss section", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-oss-"));
		const configPath = join(root, ".fizzy.yaml");
		const repo = makeBunConfigRepository();

		try {
			writeFileSync(
				configPath,
				`api_url: https://example.com
account: 1
board: board-1
oss:
  dev:
    endpoint: https://s3.dev.example.com
    region: auto
    bucket: myapp-dev
  sync:
    local_dir: public/images
    remote_prefix: images
    delete_orphans: true
`,
			);

			await Effect.runPromise(
				repo.setupOssConfig({
					env: "prod",
					config: {
						endpoint: "https://s3.prod.example.com",
						region: "us-east-1",
						bucket: "myapp-prod",
					},
					sync: {
						localDir: "public/images",
						remotePrefix: "images",
					},
					configPath,
				}),
			);

			const text = await Bun.file(configPath).text();
			expect(text).toContain("endpoint: https://s3.dev.example.com");
			expect(text).toContain("endpoint: https://s3.prod.example.com");
			expect(text).toContain("local_dir: public/images");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("loadProjectConfig parses oss section from YAML", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-oss-"));
		const configPath = join(root, ".fizzy.yaml");
		const repo = makeBunConfigRepository();
		const originalCwd = process.cwd();

		try {
			process.chdir(root);

			writeFileSync(
				configPath,
				`api_url: https://example.com
account: 1
board: board-1
oss:
  dev:
    endpoint: https://s3.dev.example.com
    region: auto
    bucket: myapp-dev
  prod:
    endpoint: https://s3.example.com
    region: us-east-1
    bucket: myapp-prod
  sync:
    local_dir: public/images
    remote_prefix: images
    concurrency: 5
    delete_orphans: true
`,
			);

			const config = await Effect.runPromise(repo.loadProjectConfig());

			expect(config.oss).toBeDefined();
			expect(config.oss!.environments["dev"]!.endpoint).toBe("https://s3.dev.example.com");
			expect(config.oss!.environments["dev"]!.region).toBe("auto");
			expect(config.oss!.environments["dev"]!.bucket).toBe("myapp-dev");
			expect(config.oss!.environments["prod"]!.endpoint).toBe("https://s3.example.com");
			expect(config.oss!.environments["prod"]!.bucket).toBe("myapp-prod");
			expect(config.oss!.sync.localDir).toBe("public/images");
			expect(config.oss!.sync.remotePrefix).toBe("images");
			expect(config.oss!.sync.concurrency).toBe(5);
			expect(config.oss!.sync.concurrency).toBe(5);
		} finally {
			process.chdir(originalCwd);
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("loadProjectConfig parses oss section with backward-compat credentials", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-oss-"));
		const configPath = join(root, ".fizzy.yaml");
		const repo = makeBunConfigRepository();
		const originalCwd = process.cwd();

		try {
			process.chdir(root);

			writeFileSync(
				configPath,
				`api_url: https://example.com
account: 1
board: board-1
oss:
  dev:
    endpoint: https://s3.dev.example.com
    region: auto
    bucket: myapp-dev
    access_key_id: AKIA123
    secret_access_key: secret123
  prod:
    endpoint: https://s3.prod.example.com
    region: us-east-1
    bucket: myapp-prod
  sync:
    local_dir: public/images
    remote_prefix: images
`,
			);

			const config = await Effect.runPromise(repo.loadProjectConfig());

			expect(config.oss).toBeDefined();
			expect(config.oss!.environments["dev"]!.accessKeyId).toBe("AKIA123");
			expect(config.oss!.environments["dev"]!.secretAccessKey).toBe("secret123");
		} finally {
			process.chdir(originalCwd);
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("OpenAPI config", () => {
	test("setupOpenApiConfig appends entry when file has other sections", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-openapi-"));
		const configPath = join(root, ".fizzyx.yaml");
		const repo = makeBunConfigRepository();

		try {
			writeFileSync(configPath, "api_url: https://example.com\naccount: 1\nboard: board-1\n");
			await Effect.runPromise(
				repo.setupOpenApiConfig({
					entry: {
						input: "https://api.example.com/openapi.json",
						output: "./src/api",
						client: "wx",
					},
					configPath,
				}),
			);

			const text = await Bun.file(configPath).text();
			expect(text).toContain("openapi:");
			expect(text).toContain("input: https://api.example.com/openapi.json");
			expect(text).toContain("client: wx");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("setupOpenApiConfig replaces openapi block with --force", async () => {
		const root = mkdtempSync(join(tmpdir(), "fizzyx-openapi-"));
		const configPath = join(root, ".fizzyx.yaml");
		const repo = makeBunConfigRepository();

		try {
			writeFileSync(
				configPath,
				`openapi:
  - input: ./old-spec.json
    output: ./old
    client: fetch
`,
			);

			await Effect.runPromise(
				repo.setupOpenApiConfig({
					entry: {
						input: "https://api.example.com/openapi.json",
						output: "./src/api",
						client: "wx",
					},
					force: true,
					configPath,
				}),
			);

			const text = await Bun.file(configPath).text();
			expect(text).not.toContain("input: ./old-spec.json");
			expect(text).toContain("input: https://api.example.com/openapi.json");
			expect(text).toContain("client: wx");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
