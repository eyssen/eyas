---
title: FAQ
description: Common problems.
---

### Port in use
`EYAS_PORT=3200 ./bin/eyas start` or free the process.

### No UI
`bun run build:web` (auto on start unless `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` or restart without `EYAS_SKIP_DOCS_BUILD`. Package: `packages/docs`.

### Provider auth error
Re-enter key under Providers/Secrets; for CLIs ensure `claude`/`grok`/`kimi` work in the same environment.

### Where is data?
`$EYAS_HOME` or cwd: `data/sqlite`, `data/vault`, `data/agents`, backups, logs.

### Wizard stuck after reload
Log in as owner, open `/setup` for remaining optional steps.
