---
title: FAQ
description: Common problems.
---

### Port in use
`EYAS_PORT=3200 ./bin/eyas start` or free the process.

### The UI is not on port 3000
Default listen port is **3100**, chosen so it does not collide with Grafana or Create React App on :3000. Open **http://localhost:3100**. Override with `EYAS_PORT` or `server.port` in YAML. Docker maps `"${EYAS_PORT:-3100}:3100"`.

### No UI
`bun run build:web` (auto on start unless `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` or restart without `EYAS_SKIP_DOCS_BUILD`. Package: `packages/docs`. Do not run `generate-full-docs.mjs` / `bun run full-docs` — it overwrites prose.

### Provider auth error
Re-enter key under Providers/Secrets; for CLIs ensure `claude`/`grok`/`kimi` work in the same environment.

### Conversations keep reading my ~/.claude / ~/.grok memory
Claude Code CLI: leave **Load host Claude config** **OFF** (default). Isolated calls also set `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Grok/Kimi ACP **cannot** be isolated — their panels say so. See [Providers](/docs/en/ai/providers/).

### Durable notes are being written and I want that off
Set `memory.capture.enabled: false` in `local.yaml` (key path `memory.capture.enabled`, default **true**). Capture skipped because it is off writes **no** `memory_capture_runs` row. See [Memory](/docs/en/knowledge/memory/) and [Configuration](/docs/en/deploy/configuration/).

### Where is data?
`$EYAS_HOME` or cwd: `data/sqlite`, `data/vault`, `data/agents`, backups, logs.

### Wizard stuck after reload
Log in as owner, open `/setup` for remaining optional steps.
