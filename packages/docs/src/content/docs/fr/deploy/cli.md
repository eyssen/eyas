---
title: Référence CLI
description: eyas serve/start/stop/doctor/config/module — opère le chemin d’install que tu as choisi.
---

**À quoi ça sert.** Le binaire `eyas` démarre, arrête, diagnostique et bascule des modules. Le même processus, le même `EYAS_HOME`.

## Quand l'utiliser

- Premier plan (`serve`) pour les logs, ou fond (`start` + pidfile).
- `doctor` avant un rapport de bug.
- Basculer un module sans éditer le YAML à la main.
- Version plus récente sur GitHub (`eyas update check`).

## Déroulement typique

1. [Natif](/docs/fr/deploy/native/) ou [Docker](/docs/fr/deploy/docker/).
2. `eyas doctor`.
3. `eyas serve` ou `eyas start`. `eyas status`.
4. Après YAML : `eyas config validate`.
5. `eyas stop` / `eyas restart`.

Commandes : serve, start, stop, restart, status, doctor, version, config validate/reload, module list/enable/disable, update check, migrate (v1→v2, pas du daily ops). Port par défaut **3100**. `EYAS_SKIP_DOCS_BUILD=1` → `/docs` 404. Voir [FAQ](/docs/fr/reference/faq/).

## Voir aussi

- [Configuration](/docs/fr/deploy/configuration/)
- [Natif](/docs/fr/deploy/native/)
- [FAQ](/docs/fr/reference/faq/)
