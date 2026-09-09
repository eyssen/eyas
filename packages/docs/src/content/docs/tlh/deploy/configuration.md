---
title: SeH
description: YAML motlh, juH overlay, env patlh — lIng He wIvpu'DI'.
---

**nuq 'oH.** Qoy pong, patmey, SeH'egh, qawHaq capture, verify ra'mey chenqa'be'. `local.yaml` 'ej `EYAS_*` — `config/default.yaml` lonlaHchugh.

## ghorgh yIlo'

- jan/lojmIt, log patlh, pat chu'Ha'.
- **`model` ra' capture** chu'Ha' (`memory.capture.enabled: false`) — motlh chu'. capture tlhol mevbe'vam: `memory.l0.enabled` SeHwI' pIm 'oH, motlh chu' je.
- **capture tlhol** chu'Ha' (`memory.l0.enabled: false`) — Hoch QIn mu' mu' cha'DIch qon Daq pa'Daq DaneHbe'chugh.
- latlh laH / persona pa'mey (`skills.importRoots` / `agent.importRoots`) host Claude SeH chu'be'.
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

### capture tlhol (0.8.23-beta)

```yaml
memory:
  engine: legacy           # 'legacy' pagh 'v2'; qawqa'meH mIw rap
  l0:
    enabled: true          # false = pagh qon tlhol pollu'
    captureToolResults: false
    toolResultMaxBytes: 8192
    idleFlushMinutes: 30
    chunkTokens: 8000
    extractInLegacy: true
```

`memory.capture` rap **'oHbe'**. capture vault ghItlhHommey ghItlh 'ej `model` ra' mach Dil; capture tlhol **Hoch QIn qonlu'bogh mu' mu' cha'DIch pol** — machmoHlu' 'ej hashDaq lanlu' — `model` ra' pagh, API Huch pagh. motlh chu'.

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.l0.enabled` | **`true`** | capture tlhol potlh SeHwI'. `false` — pagh qonlu', pagh bufferlu'. |
| `memory.l0.extractInLegacy` | **`true`** | Hoch qon ret nIteb mIw Qap (vItmey, Dov, Dochmey, topicmey, potlh chovnatlh), `engine` `legacy` taHvIS je. `false` — mu'mey pol 'ach pagh tu'. |
| `memory.engine` | **`legacy`** | `legacy` pagh `v2`. DaHjaj extraction neH SeH — `extractInLegacy` `false` taHvIS je nIteb mIw QapmoH `v2`. ja'chuq qawqa'bogh vay' choH**be'**. |
| `memory.l0.chunkTokens` | **`8000`** | tIn qonmoHwI': juvlu'bogh token mI' SIchDI', ja'chuq buffer qonlu'. |
| `memory.l0.idleFlushMinutes` | **`30`** | poH qonmoHwI': Hoch tup nejtaHbogh mIw Qongbogh buffer qon. ja'chuq SoQmoHlu'DI' 'ej EYAS mevDI' je qonlu', vaj taghqa' Say' pagh chIl. |
| `memory.l0.captureToolResults` | **`false`** | jan jangmey je qon. **Dachu'pa' veb 'ay' yIlaD.** |
| `memory.l0.toolResultMaxBytes` | **`8192`** | wa' jan jang qonlu'bogh byte 'aqroS, UTF-8 veHDaq pe'lu' 'ej pe'ta' degh leghlu'bogh ghaj. jan jangmey neH; QInmey 'aqroS Hutlh. |

**meqmo' chu'Ha'lu' `captureToolResults`.** qonlu'bogh jan jang naQ 'oH — mu' mu', So'be'lu' — 'ej ra' Dochmey 2048 ngutlh pe'lu'ta' tlhej: `run_command` stdout, `read_file` ngaSbogh, 'ej `browser_totp` wa'logh mI' yIntaHbogh — Hoch 'ay' tlholDaq motlh mu'mey rur. pagh So'lu', pagh nughlu' Daq — machmoHghach peghbe'. flag chu'DI', Hoch taghDI' mu'vam rap ghItlh ghuHmoHwI'. De'wI'vamvaD lo'laHchugh neH yIchu'.

**DaH 'ay'vam laDbe'lu'.** 0.8.23-beta ghItlh He neH 'oH: qawqa' pagh, UI nav pagh, API He pagh, `eyas memory` ra' pagh. reH vaultvo' 'ej ja'chuq ret QInmeyvo' mu'tlheghmey chenmoHlu', vaj DaHjaj `memory.engine: v2` DacherDI', pagh Daleghbogh choH.

**capture tlhol tInchoHtaH, 'ej pagh pe'.** chu'choHvamDaq poH 'aqroS SeHwI' pagh, Say'moHwI' Qu' pagh; wa' QIn qonlu'ta'bogh tlhoS 5 KB Daq natlh, indexmeyDaj tlhej. DaH Dil DaneHbe'chugh: `memory.l0.enabled: false`. [qawHaq](/docs/tlh/knowledge/memory/) yIbej.

### qawHaq tetlh, qaw je

| ngaQ | motlh | QIj |
|------|-------|-----|
| `memory.index.budgetChars` | **`2400`** | Hoch mIwDaq taHbogh qawHaq tetlh ngutlh 'aqroS (≈ 600 token). `user` `feedback` ghItlhHommeylIj je ngaSlaHbe'chugh, tlhoS 8000Daq yInIvmoH. taghqa'nISlu'. |
| `memory.recall.includeSecrets` | **`false`** | `contains-secrets` per ghajbogh ghItlhHommey, wanI' tlheghmey, laHmey je (tlhapwI' pegh tu'bogh teywI'mey, ngIq mu' mu' pollu'bogh) qawHaq tetlhDaq, rarbogh Qu'Daq, `search_memory`Daq je mIwvaD 'anglu''a'. chu'Ha'lu'DI' pollu' 'ej qawHaq HaqDaq leghlu', 'ach ra'meyDaq not SIch. taghqa'nISlu'. |

### De' pa' ratlhtaHghach

0.8.23-beta tagh, EYAS De' pa' rarwI' Hoch `PRAGMA synchronous = NORMAL` Qap, SQLite motlh `FULL` 'oHbe'. reH EYAS lo'bogh WAL tlhej:

- **Qap** Hegh — EYAS HoHlu', Qagh SeHlu'be' — commit ta'lu'ta'bogh chIlbe'.
- **De'wI' pat** Hegh pagh HoS chIl commit poHDaq — Qav jabbI'ID chIllaH.

WAL motlh Dil 'oH, 'ej **Hoch** patmey SIch, qawHaq neH ghobe'. Dachenqa'laHbe'bogh vum ngaSchugh lIng, ratlhtaHghach mo' 'oH [qon 'ej qaSqa'](/docs/tlh/admin/backup/)'e', commit mIw 'oHbe'.

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

lIng tetlh chIm. He'mey `local.yaml`Daq. import laH bundled qa' Qap. Hop taH. [laHmey](/docs/tlh/automation/skills/).

`agent.verifyCommands` shell Hutlh. `EYAS_AUTO_FAILOVER` He fallback chIm tev. `EYAS_BROWSER_USER_DATA_DIR` EYAS headless profile — Chrome jaj profile lo'Qo'. `EYAS_AGENT_BROWSER_BIN` agent-browser CLI chut (pagh PATH; He tu'lu' 'ach Hutlh chugh fail-closed). [qawHaq](/docs/tlh/knowledge/memory/) 'ej [FAQ](/docs/tlh/reference/faq/).

## latlh

- [CLI](/docs/tlh/deploy/cli/)
- [nobwI'pu'](/docs/tlh/ai/providers/)
- [He 'ej Huch](/docs/tlh/ai/routing-budget/)
- [qawHaq](/docs/tlh/knowledge/memory/)
