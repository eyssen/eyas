---
title: CLI referencia
description: eyas serve/start/stop/doctor/config/module — bármelyik telepítési úton.
---

**Mire való.** Az `eyas` bináris indít, leállít, diagnosztizál, modult kapcsol natív vagy konténeres telepítésen. Nem második termék — ugyanaz a process, ugyanaz az `EYAS_HOME`. `bin/` a PATH-on (natív) vagy az image-ben (`docker compose exec`).

## Mikor használd

- Előtér (`serve`) loghoz, vagy háttér (`start` + pidfile).
- `doctor` bug előtt — hiányzó CLI, foglalt port, docs/web dist.
- Modul kapcsolása YAML kézi szerkesztése nélkül.
- Új verzió GitHubon (`eyas update`, mint Beállítások → Frissítések).

## Tipikus folyamat

1. [Natív](/docs/hu/deploy/native/) vagy [Docker](/docs/hu/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` vagy `eyas start`. `eyas status`.
4. YAML után `eyas config validate`. `eyas config reload` ahol megy.
5. `eyas stop` / `eyas restart`.

## Funkciók

| Parancs | Leírás |
|---------|--------|
| `eyas serve` | Előtér HTTP |
| `eyas start` | Háttér (pidfile + log) |
| `eyas stop` | Háttér leállítás |
| `eyas restart` | Újraindítás |
| `eyas status` | Health + PID |
| `eyas doctor` | Diagnosztika |
| `eyas version` | Verzió |
| `eyas config validate` | YAML validálás |
| `eyas config reload` | Hot-reload ahol megy |
| `eyas module list` | Modulok |
| `eyas module enable/disable <id>` | Modul kapcsoló |
| `eyas update check` | GitHub (`eyssen/eyas`); apply-hoz kész Mentés kell |
| `eyas migrate …` | Egyszeri v1→v2 prompt/workspace migráció — nem napi ops |

### Környezet

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`.

Alap port **3100**. `EYAS_SKIP_DOCS_BUILD=1` miatt 404 a `/docs` — [GYIK](/docs/hu/reference/faq/).

## Kapcsolódó

- [Konfiguráció](/docs/hu/deploy/configuration/)
- [Natív](/docs/hu/deploy/native/)
- [GYIK](/docs/hu/reference/faq/)
- [Beállítások — Frissítések](/docs/hu/admin/settings/)
