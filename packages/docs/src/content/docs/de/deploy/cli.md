---
title: CLI-Referenz
description: eyas serve/start/stop/doctor/config/module — denselben Install-Pfad bedienen.
---

**Wozu das da ist.** Das Binary `eyas` startet, stoppt, diagnostiziert und schaltet Module. Derselbe Prozess, dasselbe `EYAS_HOME`.

## Wann du es brauchst

- Vordergrund (`serve`) für Logs, Hintergrund (`start` + Pidfile).
- `doctor` vor einem Bugreport.
- Modul ohne YAML-Handarbeit.
- Neuere Version auf GitHub (`eyas update check`).

## Typischer Ablauf

1. [Native](/docs/de/deploy/native/) oder [Docker](/docs/de/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` oder `eyas start`. `eyas status`.
4. Nach YAML: `eyas config validate`.
5. `eyas stop` / `eyas restart`.

Befehle: serve, start, stop, restart, status, doctor, version, config validate/reload, module list/enable/disable, update check, migrate (v1→v2, kein Daily-Ops). Default-Port **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404. Siehe [FAQ](/docs/de/reference/faq/).

## Verwandt

- [Konfiguration](/docs/de/deploy/configuration/)
- [Native](/docs/de/deploy/native/)
- [FAQ](/docs/de/reference/faq/)
