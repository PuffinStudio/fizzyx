# fizzyx

CLI tool for Fizzy board workflow and OSS/S3-compatible storage management.

## Install

```sh
bun add -g @puffinstudio/fizzyx
```

## OSS Commands

Manage S3-compatible object storage (Alibaba Cloud OSS, AWS S3, MinIO, etc.).

### Setup

```sh
# Interactive blank scaffold (prompts for keys)
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

### Sync

Upload local files to the remote bucket:

```sh
fizzyx oss sync [--env dev] [--full] [--no-urls]
```

- `--env`: environment name (default: `dev`)
- `--full`: ignore cached manifest, force full re-upload
- `--no-urls`: suppress file URL output

Sync uses a two-stage check (mtime+size → SHA-256 hash) to skip unchanged files. The manifest is stored at `.fizzyx/oss-manifest.json` and can be committed for team sharing.

### List

List objects in the remote bucket:

```sh
fizzyx oss ls [--env dev] [--prefix assets/]
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
