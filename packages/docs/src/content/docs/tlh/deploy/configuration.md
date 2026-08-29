---
title: SeH
description: YAML motlh, juH overlay, env patlh — lIng He wIvpu'DI'.
---

**nuq 'oH.** Qoy pong, patmey, SeH'egh, qawHaq capture, verify ra'mey chenqa'be'. `local.yaml` 'ej `EYAS_*` — `config/default.yaml` lonlaHchugh.

## ghorgh yIlo'

- jan/lojmIt, log patlh, pat chu'Ha'.
- nI' qawHaq capture chu'Ha' (`memory.capture.enabled: false`) — motlh chu'.
- `agent.verifyCommands` ghItlh Qap «rIn» chovpa' be'.
- law' Odoo checkout `EYAS_ODOO_SOURCES_JSON`.

## motlh mIw

1. `local.yaml` yIchen.
2. poQbogh ngoq neH. `eyas config validate`.
3. `eyas restart` pagh `eyas config reload`.
4. SeHmey + `eyas doctor`.

patlh: CLI flags → `EYAS_*` → juH YAML → motlh YAML.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

`agent.verifyCommands` shell Hutlh. `EYAS_AUTO_FAILOVER` He fallback chIm tev. `EYAS_BROWSER_USER_DATA_DIR` EYAS headless profile — Chrome jaj profile lo'Qo'. `EYAS_AGENT_BROWSER_BIN` agent-browser CLI chut (pagh PATH; He tu'lu' 'ach Hutlh chugh fail-closed). [qawHaq](/docs/tlh/knowledge/memory/) 'ej [FAQ](/docs/tlh/reference/faq/).

## latlh

- [CLI](/docs/tlh/deploy/cli/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [He 'ej Huch](/docs/tlh/ai/routing-budget/)
- [qawHaq](/docs/tlh/knowledge/memory/)
