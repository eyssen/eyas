---
title: Több példány
description: Külön EYAS_HOME és portok — soha két író egy SQLite fájlon.
---

**Mire való.** Egy gépen több EYAS is futhat (dev + személyes, vagy két Compose projekt). Az izoláció **adatkönyvtár + port**, nem „két process, egy DB”. Az SQLite nem multi-writer cluster.

## Mikor használd

- Második példány ugyanazon a laptopon, vaultok keverése nélkül.
- Docker: második Compose projektnév és host port.
- Scheduler health **Leader / Follower** debug.

## Tipikus folyamat

1. Új `EYAS_HOME` (data, pid, local.yaml) és szabad `EYAS_PORT` (pl. 3200).
2. Natív: `EYAS_HOME=/path/to/home EYAS_PORT=3200 eyas start`.
3. Docker: `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Mindegyik UI a saját portján. **Soha** ne mutass két élő példányt ugyanarra az SQLite fájlra.
5. A scheduler health **Leader / Follower** job-clusterre — ez sem jelent megosztott SQLite-ot.

## Funkciók

| Kar | Cél |
|-----|-----|
| `EYAS_HOME` | Külön data, pid, local config |
| `EYAS_PORT` / `--port` | Nem ütköző listen port |
| Compose projektnév | Több stack egy Docker hoston |

**Soha** ne mutass két élő példányt ugyanarra az SQLite fájlra.

## Kapcsolódó

- [Natív](/docs/hu/deploy/native/)
- [Docker](/docs/hu/deploy/docker/)
- [Ütemező](/docs/hu/automation/scheduler/)
- [CLI](/docs/hu/deploy/cli/)
