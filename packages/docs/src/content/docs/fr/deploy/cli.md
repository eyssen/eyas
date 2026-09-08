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

## Ce que vérifie `doctor`

Deux de ses lignes sont nouvelles en 0.8.23-beta, et toutes deux concernent l’enregistrement brut de la mémoire.

| Ligne | Signification |
|-------|---------------|
| **SQLite** | Un auto-test en direct sur une base en mémoire jetable — ton fichier de données n’est jamais ouvert. Rapporte la version de SQLite, la présence de **FTS5** (échec sans lui : la recherche mémoire, la recherche de conversations et celle du coffre en ont toutes besoin) et le chargement de l’extension `sqlite-vec`, en insérant réellement une ligne et en lançant une requête du plus proche voisin plutôt qu’en demandant seulement la version. Une extension manquante est un avertissement avec le remède pour ta plateforme, pas un échec. |
| **zstd** | Quelle implémentation de compression servira à l’enregistrement brut : celle native de Bun, celle de Node (22.15 ou plus récent), ou le repli WASM embarqué. Le repli est un avertissement — il marche, et il est environ deux fois plus lent. Aucune implémentation du tout est un échec, et EYAS n’enregistre alors rien plutôt que de remplir un tampon qu’il ne pourra jamais écrire. |

## Voir aussi

- [Configuration](/docs/fr/deploy/configuration/)
- [Natif](/docs/fr/deploy/native/)
- [FAQ](/docs/fr/reference/faq/)
