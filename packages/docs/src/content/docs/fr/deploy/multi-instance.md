---
title: Plusieurs instances
description: EYAS_HOME et ports séparés — jamais deux écrivains sur le même SQLite.
---

**À quoi ça sert.** Une machine peut faire tourner plus d’une EYAS. L’isolation est **répertoire de données + port**, pas « deux processus, une BD ». SQLite n’est pas un cluster multi-écrivain.

## Quand l'utiliser

- Seconde instance sur le même portable sans mélanger les vaults.
- Docker : second nom de projet Compose et port hôte.
- Santé du planificateur **Leader / Follower**.

## Déroulement typique

1. Nouveau `EYAS_HOME` et `EYAS_PORT` libre (ex. 3200).
2. Natif : `EYAS_HOME=… EYAS_PORT=3200 eyas start`.
3. Docker : `EYAS_PORT=3200 docker compose -p eyas-dev up -d`.
4. Chaque UI sur son port. **Jamais** deux instances live sur le même fichier SQLite.

| Réglage | Rôle |
|---------|------|
| `EYAS_HOME` | Données, pid et config locale séparés |
| `EYAS_DATA_DIR` | Optionnel : placer le répertoire de données d’une instance ailleurs. La base **et le coffre de mémoire** (`<répertoire de données>/vault`) le suivent |
| `EYAS_WORKSPACES_DIR` | Optionnel : où vivent les espaces de travail des conversations de cette instance |
| `EYAS_PORT` / `--port` | Port d’écoute sans collision |
| Nom de projet Compose | Plusieurs stacks sur un même hôte Docker |

**Coffres et espaces de travail restent séparés.** Le coffre de chaque instance est `<répertoire de données>/vault` : des répertoires de données séparés donnent des coffres séparés. Sur une install depuis les sources lancée depuis un clone git, les espaces de travail des conversations vivent dans un dossier par instance nommé d’après le dossier home d’EYAS plus un court hash du répertoire de données, donc une instance dev et une instance live sur une même machine ne partagent jamais leurs espaces de travail. Si tu règles `EYAS_WORKSPACES_DIR`, donne à chaque instance son propre chemin. Voir [Configuration — Espaces de travail des conversations](/docs/fr/deploy/configuration/#conversation-workspaces).

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Docker](/docs/fr/deploy/docker/)
- [Planificateur](/docs/fr/automation/scheduler/)
- [CLI](/docs/fr/deploy/cli/)
- [Configuration](/docs/fr/deploy/configuration/)
