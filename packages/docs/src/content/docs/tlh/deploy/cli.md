---
title: CLI De'
description: eyas serve/start/stop/doctor/config/module — lIng He yIwIvpu' SeH.
---

**nuq 'oH.** `eyas` jan tagh, mev, chov, pat chu'. rap Qap, rap `EYAS_HOME`.

## ghorgh yIlo'

- tlhop (`serve`) logvaD, pagh 'em (`start` + pidfile).
- `doctor` Qagh ja'pa'.
- pat chu' YAML ghItlh lo'be'.
- chu' mI' GitHubDaq (`eyas update check`).

## motlh mIw

1. [juH](/docs/tlh/deploy/native/) pagh [Docker](/docs/tlh/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` pagh `eyas start`. `eyas status`.
4. YAML 'em: `eyas config validate`.
5. `eyas stop` / `eyas restart`.

ra'mey: serve, start, stop, restart, status, doctor, version, config validate/reload, module list/enable/disable, update check, migrate (v1→v2, jaj ops 'oHbe'). motlh lojmIt **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404. [FAQ](/docs/tlh/reference/faq/).

### `doctor` nuq bej

cha' tlhegh chu' 0.8.23-betaDaq; qawHaq tetlh tlhol luSIch cha'.

| tlhegh | QIj |
|--------|-----|
| **SQLite** | logh De' pa'Daq yIntaHbogh chov'egh — De' pa'lIj poSmoHlu'be' not. SQLite chovnatlh ja', **FTS5** tu'lu''a' (Hutlhchugh lujlu': qawHaq, ja'chuq, vault nej Hoch poQ), 'ej `sqlite-vec` chelwI' 'el'a' — mI' tlhoblu' neH ghobe', 'ach tetlh chellu' 'ej Sumqu'bogh nejlu'. chelwI' Hutlhchugh, luj 'oHbe': ghuHmoHwI' 'oH, 'ej pat SeghlIjvaD tI'meH mIw ja'. |
| **zstd** | tetlh tlhol machmoHmeH nuq lo'lu' ja': Bun machmoHwI', Node (22.15 pagh nIv), pagh ngaSlu'bogh WASM chuvwI'. chuvwI' ghuHmoHwI' 'oH — Qap 'ach tlhoS cha'logh QIt. pagh tu'lu'chugh, lujlu': ghItlhlaHbe'bogh buffer tebmeH ghobe', EYAS pagh qon. |

## latlh

- [SeH](/docs/tlh/deploy/configuration/)
- [juH](/docs/tlh/deploy/native/)
- [FAQ](/docs/tlh/reference/faq/)
