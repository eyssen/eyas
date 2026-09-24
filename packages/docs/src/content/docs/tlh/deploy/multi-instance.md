---
title: law' pat
description: nIteb EYAS_HOME 'ej lojmIt — reH be' cha' ghItlhwI' wa' SQLiteDaq.
---

**nuq 'oH.** wa' jan law' EYAS QaplaH. nIteb **De' paq + lojmIt** 'oH, «cha' Qap, wa' DB» 'oHbe'. SQLite law' ghItlhwI' ghom 'oHbe'.

## ghorgh yIlo'

- cha'DIch pat rap qep'a'Daq vault mixbe'.
- Docker: cha'DIch Compose Qu' pong + juH lojmIt.
- poH SeHwI' yIn **Leader / Follower**.

## motlh mIw

1. chu' `EYAS_HOME` 'ej lojmIt chIm (3200).
2. juH: `EYAS_HOME=… EYAS_PORT=3200 eyas start`.
3. Docker: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Hoch UI lojmItDajDaq. **reH be'** cha' yIn pat wa' SQLite tejDaq.

`EYAS_DATA_DIR` (poQbe'): pat De' paq latlh DaqDaq yIlan — De' pa' **'ej qawHaq vault** (`<data dir>/vault`) tlhej vIH. `EYAS_WORKSPACES_DIR` (poQbe'): patvetlh ja'chuq vum pa'mey Daq.

**vaultmey vum pa'mey je chev taH.** Hoch pat vault `<data dir>/vault` 'oH, vaj De' paq pIm = vault pIm. git clonevo' Qapbogh Hal lIngDaq, ja'chuq vum pa'mey Hoch patvaD paqDaq yIn — EYAS home paq pong 'ej De' paq hash mach — vaj wa' De'wI'Daq dev 'ej yIn pat vum pa'mey nobchuq not. `EYAS_WORKSPACES_DIR` Dacherchugh, Hoch pat He Daj yInob. [SeH — ja'chuq vum pa'mey](/docs/tlh/deploy/configuration/#conversation-workspaces).

## latlh

- [juH](/docs/tlh/deploy/native/)
- [Docker](/docs/tlh/deploy/docker/)
- [poH SeHwI'](/docs/tlh/automation/scheduler/)
- [CLI](/docs/tlh/deploy/cli/)
- [SeH](/docs/tlh/deploy/configuration/)
