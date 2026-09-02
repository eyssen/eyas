---
title: FAQ
description: motlh Qaghmey.
---

### lojmIt lo'lu'
`EYAS_PORT=3200 ./bin/eyas start` pagh Qap yIchImmoH.

### UI lojmIt 3000Daq tu'lu'be'
motlh Qoy lojmIt **3100** 'oH, Grafana pagh Create React App :3000 lon. **http://localhost:3100** yIpoS. choH: `EYAS_PORT` pagh `server.port`. Docker: `"${EYAS_PORT:-3100}:3100"`.

### UI tu'lu'be'
`bun run build:web` (taghDI' chen, `EYAS_SKIP_WEB_BUILD=1` Hutlhchugh).

### /docs 404
`bun run docs:build` pagh taghqa' `EYAS_SKIP_DOCS_BUILD` Hutlh. tev: `packages/docs`. `generate-full-docs.mjs` / `bun run full-docs` yIbaHQo' — ghItlh nIH.

### nobwI' chaw' Qagh
ngoq nobwI'pu'/peghmeyDaq yIchelqa'; CLI `claude`/`grok`/`kimi` rap juHDaq Qap.

### ja'chuq ~/.claude / ~/.grok qawHaq laD
Claude Code CLI: **juH Claude SeH tev** **chu'Ha'** yItaH (motlh). nIteb ra' je `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Grok/Kimi ACP nIteb SeHlaHbe'. [nobwI'pu'](/docs/tlh/ai/providers/).

### nI' QIn ghItlhlu' 'ej chu'Ha' vIneH
`memory.capture.enabled: false` `local.yaml`Daq (motlh **true**). chu'Ha' = `memory_capture_runs` tetlh tu'lu'be'. [qawHaq](/docs/tlh/knowledge/memory/) 'ej [SeH](/docs/tlh/deploy/configuration/).

### De' nuqDaq?
`$EYAS_HOME` pagh cwd: `data/sqlite`, `data/vault`, `data/agents`, qon, log.

### ghojmoHwI' chu'qa'DI' taH
joH 'el, `/setup` yIpoS latlh chaw' mIwvaD.
