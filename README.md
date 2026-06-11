# fizzyx

AI workflow CLI for Fizzy boards.

`fizzyx` is a Bun + Effect 4 beta CLI that reads `.fizzy.yaml`, stores auth locally, talks to the Fizzy HTTP API directly, and adds project workflow commands optimized for AI agents.

## Install

```bash
bun install
```

## Setup

```bash
fizzyx setup <board-id>

fizzyx setup --list
```

This creates `.fizzy.yaml` with official Fizzy fields plus a `flow:` section.
`setup --list` prints available board ids and names for the active account.

If TODO/INPROGRESS columns are omitted, `fizzyx setup` auto-discovers them from the API.

## Auth

```bash
fizzyx auth login <token>
fizzyx auth status
```

Tokens are stored outside the repo under `~/.config/fizzyx/credentials/`.

## Commands

```bash
fizzyx flow sync
fizzyx flow mine --fresh
fizzyx flow status
fizzyx flow next
fizzyx flow show 123
fizzyx flow start 123
fizzyx flow done 123 "commit abc123: subject"
fizzyx flow block 123 "waiting on API"
fizzyx flow add ray "[Page] home · title" --desc /tmp/card.md
fizzyx flow add ray "[Page] home · title" --desc - < /tmp/card.md
fizzyx flow steps-from-desc 123
```

During development, you can run the entrypoint directly:

```bash
bun run src/main.ts <command>
```

## Architecture

- `src/domain`: errors and models
- `src/ports`: repository/API interfaces
- `src/adapters`: Bun filesystem/cache and fetch-based Fizzy API
- `src/use-cases`: workflow use cases
- `src/cli`: thin command parsing and rendering

## Check

```bash
bun run check
```
