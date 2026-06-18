# fizzyx

CLI tool for Fizzy board workflow and OSS/S3-compatible storage management.

## Install

```sh
bun add -g @puffinstudio/fizzyx
```

## Flow Commands

Manage a Fizzy board from a repository-local `.fizzy.yaml`.

### Setup

```sh
fizzyx setup <board-id>
fizzyx auth login <token>
fizzyx auth status
fizzyx flow doctor
```

`flow doctor` shows account, board, workflow columns, and whether the CLI is ready to operate on the board.

### Create A Card

Use `--draft` to create a unique project-local draft file. This automatically creates `.fizzyx/` when needed and avoids collisions between multiple agents.

```sh
draft=$(fizzyx flow template --draft)
$EDITOR "$draft"
fizzyx flow add Ellen "Implement feature" --desc "$draft"
rm "$draft"
```

You can also pipe or provide your own file:

```sh
fizzyx flow template
fizzyx flow add <user> "<title>" --desc <file|->
```

### Work A Card

```sh
fizzyx flow mine --fresh
fizzyx flow next --fresh
fizzyx flow show <card>
fizzyx flow start <card>
fizzyx flow complete-steps <card>
fizzyx flow done <card> "commit <sha>: <subject>"
```

`flow done` requires all steps to be complete and closes the card into Done.

### Other Flow Commands

```sh
fizzyx flow sync
fizzyx flow status [--fresh]
fizzyx flow assign <card> <user|me> [user...]
fizzyx flow block <card> "<reason>"
fizzyx flow repair-markdown <card>
fizzyx flow std <card>
fizzyx flow std-all
fizzyx flow workflow
fizzyx flow skill
fizzyx flow skill init [--force]
```

- `flow assign <card> me` assigns the card to the authenticated Fizzy user.
- `flow assign` skips users who are already assigned.
- `flow block` moves the card to Not Now.
- `flow workflow`, `flow skill`, and `flow template` prefer project-local overrides under `.agents/skills/fizzyx/`.

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

## Config File (`.fizzy.yaml`)

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
3. `.fizzy.yaml` `access_key_id` / `secret_access_key` fields (legacy, discouraged)

Credentials stored as `default` (without `--env`) are used as a fallback for all environments when no env-specific key is found. This means you only need to run `fizzyx oss setup` once — dev, prod, and any other env will reuse the same keys.
