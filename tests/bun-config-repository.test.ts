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
  sources:
    mattpocock:
      repo: https://github.com/mattpocock/skills
      ref: v1.0.1
  installed:
    tdd:
      source: builtin
      version: 1.0.0
    improve-codebase:
      source: git
      repo: https://github.com/mattpocock/skills
      ref: v1.0.1
      commit: abc123
      path: skills/engineering/improve-codebase-architecture
  defaults:
    feature:
      - tdd
      - codebase-design
    bug:
      - diagnose
      - tdd
  areas:
    auth:
      - security-review
`,
		);

		const config = await Effect.runPromise(repo.loadProjectConfig());

		expect(config.skills).toEqual({
			version: 1,
			sources: {
				mattpocock: {
					repo: "https://github.com/mattpocock/skills",
					ref: "v1.0.1",
				},
			},
			installed: {
				tdd: {
					source: "builtin",
					version: "1.0.0",
				},
				"improve-codebase": {
					source: "git",
					repo: "https://github.com/mattpocock/skills",
					ref: "v1.0.1",
					commit: "abc123",
					path: "skills/engineering/improve-codebase-architecture",
				},
			},
			defaults: {
				feature: ["tdd", "codebase-design"],
				bug: ["diagnose", "tdd"],
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
  sources:
    mattpocock:
      repo: https://github.com/mattpocock/skills
      ref: v1.0.1
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
			sources: {
				mattpocock: {
					repo: "https://github.com/mattpocock/skills",
					ref: "v1.0.1",
				},
			},
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
		expect(text).toContain("sources:");
		expect(text).toContain("mattpocock:");
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
