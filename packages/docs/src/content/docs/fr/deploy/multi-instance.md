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

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Docker](/docs/fr/deploy/docker/)
- [Planificateur](/docs/fr/automation/scheduler/)
- [CLI](/docs/fr/deploy/cli/)
