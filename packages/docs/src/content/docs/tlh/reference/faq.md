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
ngoq nobwI'pu'/peghmeyDaq yIchelqa'. Claude CodevaD, rap juHDaq `claude` 'ellu'ta' 'e' yIHon. EYASvaD 'ellu' Grok Kimi je nobwI' navchajDaq, juHDaq ghobe'.

### ja'chuq ~/.claude / ~/.grok qawHaq laD
DaH laDlaHbe'. reH nIteb Qap Claude Code — qach `CLAUDE.md`, SeHmey, hooks, laHmey, MCP De'wI'mey, auto-qawHaq pagh, 'ej `~/.claude/projects`Daq ja'chuq qon pagh; ngo' **Load host Claude config** SeHwI' teqlu'. EYAS juHchajDaq Qap Grok CLI Kimi Code CLI je 'ej `~/.grok`, `~/.kimi`, `~/.claude` leghbe' not. Hoch patvaD latlh jan qawHaq laD ghItlh je lajQo' Hub lojmIt, 'ej qawHaq pa' MCP De'wI'mey botlu'. Sovvetlh EYASDaq DaqemmeH, wa'logh yItlhap: **SeHmey → System → De' vIH → De' yItlhap**. [nobwI'pu' — Claude Code nIteb](/docs/tlh/ai/providers/#claude-code-isolation), [qawHaq](/docs/tlh/knowledge/memory/#memory-outside-eyas-is-refused).

### chu'choH ret jangbe'choH Grok pagh Kimi
DaH EYAS juH'eghDaq Qap Grok CLI Kimi Code CLI je, vaj De'wI' CLI 'el lo'be'lu'. EYASvaD wa'logh yI'el: **nobwI'pu' → Grok CLI / Kimi Code CLI → Sign in for EYAS** (De'wI' ngoq; xAI API ngoq laj Grok je). tu'pa', **Sign-in required** 'ang chovnatlh 'ej *… is not signed in for EYAS* tlhej luj mIwmey. [nobwI'pu' — EYASvaD Grok Kimi je yI'el](/docs/tlh/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### "could not confirm that it runs isolated" tlhej mIw luj
CLI nIteb ghorlaHbogh juHDaq vay' tu' EYAS — latlh MCP De'wI', hook, plugin, pagh laH, Hoch De'wI'vaD Grok SeH, pagh latlh chaw' mIw ra'bogh Claude Code ghom chut rur. meq yIteq 'ej QIn yIngeHqa'; latlh patDaq mIw noblu' not. [nobwI'pu' — nIteb chov](/docs/tlh/ai/providers/#isolation-check-before-every-turn), [Claude Code nIteb](/docs/tlh/ai/providers/#claude-code-isolation).

### MCP De'wI' "Blocked: memory store" 'ang
EYAS Hur cha'DIch qawHaq pol (Memory, Qdrant, Obsidian, MCPVault, …) pagh Hublu'bogh pa' 'oS, vaj tagh not EYAS. latlh DaqDaq 'oSmeH yIchoH, pagh yIteq, 'ej De' tlhap lo'taHvIS qawHaqvetlh yIqem. [MCP](/docs/tlh/ai/mcp/#memory-store-servers-are-blocked).

### Claude Code lIngta' 'ach nobwI' tu'lu'be'
Claude Code QapwI' **'ellu'ta'** poQ EYAS, PATHDaq neH ghobe': claude.ai 'el, `ANTHROPIC_API_KEY`, pagh Bedrock/Vertex SeH. `eyas doctor` yIlo' — **Claude Code runtime** tlhegh 'Iv QapwI' Qap EYAS 'ej 'ellu'ta''a' 'ang. Qu' PATH `claude` ghajbe'laH; naQ HeDaq `EYAS_CLAUDE_CODE_BIN` yIcher. Da'elDI', nobwI'pu'Daq nobwI' yIchu'Ha' 'ej yIchu'qa', pagh yItaghqa'. [nobwI'pu' — Claude Code Qap](/docs/tlh/ai/providers/#claude-code-runtime).

### nI' QIn ghItlhlu' 'ej chu'Ha' vIneH
`memory.capture.enabled: false` `local.yaml`Daq (motlh **true**). chu'Ha' = `memory_capture_runs` tetlh tu'lu'be'. [qawHaq](/docs/tlh/knowledge/memory/) 'ej [SeH](/docs/tlh/deploy/configuration/).

### De' nuqDaq?
`$EYAS_HOME` pagh cwd: `data/sqlite`, `data/vault`, `data/agents`, qon, log. `EYAS_DATA_DIR` De' paq naQ vIH; vault tlhej vIH (`<data dir>/vault`). git clonevo' Qapbogh Hal lIng ja'chuq vum pa'mey lo'wI' ghun De' paqDaq yIn — [SeH](/docs/tlh/deploy/configuration/#conversation-workspaces).

### `EYAS_DATA_DIR` vIcherpu' 'ej qawHaq ghItlhHommeywIj tu'lu'be'
ngo' chovnatlhmey `<EYAS home>/data/vault`Daq vault pol, latlh DaqDaq `EYAS_DATA_DIR` 'oSDI' je. chu'choH wa'DIch taghDI' ghItlhHommeyvetlh `<data dir>/vault`Daq wa'logh cha'loghlu' — chu' vault ghItlhHom ngaSbe'taHvIS neH. `eyas doctor` yIlo': **Vault** tlhegh ja' cha'logh loS'a', pagh cha' paqmey ghItlhHommey ngaSmo' ngo' paq lo'be'lu''a' — vaj poQbogh ghItlhHom ghop yIcha'logh. [SeH — De' paq 'ej vault](/docs/tlh/deploy/configuration/#data-directory-and-vault).

### pat juH poH muj Suq
`local.yaml`Daq `i18n.timezone` (IANA pong, `Europe/Berlin` rur) yIcher 'ej yItaghqa'. chIm: De'wI' poH yoS lo' EYAS — `TZ`, pagh Qap pat; ngaSwI'mey motlh UTC. [SeH](/docs/tlh/deploy/configuration/#time-zone-of-the-models-clock).

### ghojmoHwI' chu'qa'DI' taH
joH 'el, `/setup` yIpoS latlh chaw' mIwvaD.
