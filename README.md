# fizzyx

> CLI tool for Fizzy board workflow, OSS/S3-compatible storage, and OpenAPI client generation.

> <img src="./docs/images/fizzyx-logo.png" alt="fizzyx logo" width="120" />

## Install

```sh
bun add -g @puffinstudio/fizzyx
```

## Flow Commands

Use `.fizzyx.yaml` as the project config file for board and workflow settings.

```sh
fizzyx flow work
fizzyx flow create <user> "<title>" --desc <file|->
fizzyx flow show <card>
fizzyx flow start <card>
fizzyx flow review <card>
fizzyx flow done <card> "commit <sha>: <subject>"
fizzyx flow block <card> "<reason>"
fizzyx flow improve
fizzyx flow doctor
fizzyx flow repair
```

`flow done` requires all steps to be complete and closes the card into Done.

Use `fizzyx skill ...` for bundled skills and project pins. Use flow commands for repair and health checks.

![Flow command lifecycle](./docs/images/flow-workflow.png)

## Dev Commands (AI Agent Git Workflow)

Use these for guard-railed branching and promotion checks (documented in
`docs/ai-agent-git-workflow.md`):

```sh
fizzyx dev status --agent
fizzyx dev start <slug> --kind <feature|fix|hotfix|ops|chore|docs> [--card <id>]
fizzyx dev sync
fizzyx dev checkpoint [--message <message>]
fizzyx dev ready [--agent] [--full]
fizzyx dev promote <source> --to <environment|main> --dry-run
fizzyx dev cleanup [--confirm-delete]
fizzyx dev doctor
```

Production promotions stay guarded:

```sh
fizzyx dev promote <source> --to main --dry-run   # preview + blocking checks
fizzyx dev promote <source> --to main --apply --confirm-production
```

## Skill Commands

```sh
fizzyx skill list
fizzyx skill add <source>
fizzyx skill remove <name>
fizzyx skill update [name]
fizzyx skill info <name>
fizzyx skill run <name>
fizzyx skill doctor
fizzyx skill migrate --check
fizzyx skill migrate --apply
```

Built-in skills are bundled. `skill update [name]` refreshes the local copy from the current fizzyx release.

![Skill command workflow](./docs/images/skill-workflow.png)

## Planner Dashboard

Start a local planner dashboard backed directly by the Fizzy API:

```sh
fizzyx planner start
fizzyx planner snapshot
fizzyx planner chat-config --host peer.example.com --port 443 --path /peerjs
```

![Planner dashboard workflow](./docs/images/planner-workflow.png)

`planner snapshot` prints the same JSON used by the web dashboard. Project workflow uses `BACKLOG → READY → IN PROGRESS → REVIEW → DONE`, with `DONE` coming from closed cards and `BLOCKED` from Not Now/postponed cards.

`planner chat-config` stores the Team Chat signaling server globally in `~/.config/fizzyx/config.yaml`. Use `--insecure` for local HTTP/ws PeerServer instances.

Planner conventions use tags for filtering:

```text
priority:p0 priority:p1 priority:p2
type:bug type:feature type:chore type:blocker
area:frontend area:api phase:integration
```

Cards can also include frontmatter for richer project details:

```md
---
priority: P1
type: feature
owner: ellen
depends_on: [123]
---
```

`api_status:*` and `skill:*` are not standard tags in 1.0 and are treated as free-form tags only.

## OSS Commands

Manage S3-compatible object storage (Alibaba Cloud OSS, AWS S3, MinIO, etc.).

### Setup

```sh
# Interactive — prompts for keys, stores in OS keychain
fizzyx oss setup

# With explicit config (keys are prompted separately)
fizzyx oss setup --env dev --endpoint https://oss-cn-beijing.aliyuncs.com --region cn-beijing --local-dir ./public [--bucket my-bucket] [--remote-prefix assets]

# Configure keys for an existing environment
fizzyx oss setup --env dev
```

- `--endpoint` and `--region` are required
- `--bucket` is optional — omit if your endpoint already includes the bucket name (e.g. `https://my-bucket.oss-cn-beijing.aliyuncs.com`)
- `--remote-prefix` is optional — omit to upload to bucket root
- Credentials are stored in OS keychain via `Bun.secrets`, never in config files or shell history
- Without `--env`, keys are stored as `default` — all environments fall back to it

![OSS command workflow](./docs/images/oss-workflow.png)

### Sync

Upload local files to the remote bucket:

```sh
fizzyx oss sync [--env dev] [--full] [--no-urls] [--verify]
```

- `--env`: environment name (default: `dev`)
- `--full`: ignore cached manifest, force full re-upload
- `--no-urls`: suppress file URL output
- `--verify`: check remote existence before skipping (re-upload if deleted remotely)

Sync uses a two-stage check (mtime+size → SHA-256 hash) to skip unchanged files. The manifest is stored at `.fizzyx/oss-manifest.json` and can be committed for team sharing.

During sync, a live progress bar shows current file, progress, and status:

```
  ◐ dev [████░░░░░░░░░░░░] 25%  ↑ filename.jpg
```

### List

List objects in the remote bucket in a tree view with file sizes:

```sh
fizzyx oss ls [--env dev] [--prefix assets/]
```

```
└── assets/
    └── Monkey_D._Luffy_Anime_Post_Timeskip_Infobox.webp  126.2 KB
```

- `--prefix`: filter objects by key prefix

### Status

Show sync status (pending uploads, manifest info):

```sh
fizzyx oss status [--env dev]
```

List exact pending files without uploading:

```sh
fizzyx oss status --files
```

## OpenAPI Commands

Generate a typed API client from an OpenAPI spec.

### Generate

```sh
fizzyx openapi generate -i <url|path> -o <dir> -c wx
```

Options:

| Flag                       | Description                                             |
| -------------------------- | ------------------------------------------------------- |
| `-i, --input <url\|path>`  | OpenAPI spec URL or file path (JSON/YAML)               |
| `-o, --output <dir\|file>` | Output directory (or `.ts` path for custom api name)    |
| `-c, --client <name>`      | Client target (`wx`)                                    |
| `--api-name <name>`        | API filename (default: `api.ts`)                        |
| `--types-name <name>`      | Types filename (default: `types.ts`, `false` to inline) |
| `--runtime-name <name>`    | Runtime filename (default: `wx-request.ts`)             |
| `--run <script\|cmd>`      | npm script or shell command after generation            |

If `--input`/`--output`/`--client` are omitted, values from `.fizzyx.yaml` `openapi[0]` are used.

Output is 3 files — runtime, types, and tree-shakeable endpoint functions:

```
src/api/
  ├── wx-request.ts   # runtime (configure, setToken, onError, request)
  ├── types.ts        # named interfaces / enums / aliases
  └── api.ts          # tree-shakeable export functions + param types
```

### Generated Runtime API

```ts
import { configure, setToken, onError, initToken } from "./api";

// Setup at app startup
configure({ baseUrl: "https://api.example.com", storageKey: "myapp_token" });

// Or with custom logger + hooks
configure({
	baseUrl: "https://api.example.com",
	storageKey: "tb_token",
	logger: { error: myReporter, warn: () => {}, info: () => {}, debug: () => {} },
	hooks: [
		{ onError: (ctx) => wx.showToast({ title: ctx.message }) },
		{ onSuccess: (ctx) => reportAnalytics(ctx) },
	],
});

// Token auto-loads from storage. Explicit load if needed:
await initToken();

// Token persists to storage on set
setToken("jwt...");
setToken(null); // logout, clears storage
```

**Logger vs Hooks:**

- `Logger` controls **output** (console, file, sentry). Default: `console.error/warn/info/debug` with `[fizzyx]` prefix.
- `RequestHook` fires **business callbacks** at lifecycle points (`onRequest`, `onSuccess`, `onError`). Use for toast, analytics, loading state.

### Generated Endpoint API

Each endpoint is a standalone export function with typed params:

```ts
import { listPets, createPet, ListPetsQueryParams } from "./api";

// GET with query params
const pets = await listPets({ query: { limit: 10, status: "available" } });

// POST with body
const pet = await createPet({ name: "Fluffy" });

// POST without requestBody (no data param generated)
const result = await someAction();
```

- No `createApi()` wrapper — tree-shakeable by default
- Each function exports its param types (`ListPetsQueryParams`, `CreatePetPathParams`)
- JSDoc comments from OpenAPI `description`/`summary` on endpoints and params

### List Generators

```sh
fizzyx openapi list
```

![OpenAPI generation workflow](./docs/images/openapi-workflow.png)

### Initialize OpenAPI config

```sh
fizzyx openapi init
```

### Config (`.fizzyx.yaml`)

```yaml
openapi:
  - input: ./openapi.json
    output: ./src/api
    client: wx
    api_name: sdk.ts
    types_name: types.ts
    runtime_name: wx-request.ts
    run: check
```

## Config File (`.fizzyx.yaml`)

Minimal OSS-only config:

```yaml
oss:
  dev:
    endpoint: https://oss-cn-beijing.aliyuncs.com
    region: cn-beijing
    bucket: my-bucket
  sync:
    local_dir: ./public
    remote_prefix: assets
    concurrency: 10
```

If your endpoint already contains the bucket in the hostname, `bucket` can be omitted:

```yaml
oss:
  dev:
    endpoint: https://my-bucket.oss-cn-beijing.aliyuncs.com
    region: cn-beijing
  sync:
    local_dir: ./public
```

## Credential Resolution

Credentials are resolved in this priority order:

1. OS keychain (`Bun.secrets` — set via `fizzyx oss setup`)
2. Environment variables: `OSS_<ENV>_ACCESS_KEY_ID` / `OSS_<ENV>_SECRET_ACCESS_KEY`
3. `.fizzyx.yaml` `access_key_id` / `secret_access_key` fields (legacy, discouraged)

Credentials stored as `default` (without `--env`) are used as a fallback for all environments when no env-specific key is found. This means you only need to run `fizzyx oss setup` once — dev, prod, and any other env will reuse the same keys.
