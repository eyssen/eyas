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

## latlh

- [SeH](/docs/tlh/deploy/configuration/)
- [juH](/docs/tlh/deploy/native/)
- [FAQ](/docs/tlh/reference/faq/)
