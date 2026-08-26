---
title: FAQ
description: Problèmes fréquents.
---

### Port déjà utilisé
`EYAS_PORT=3200 ./bin/eyas start` ou libérez le processus.

### Pas d'interface
`bun run build:web` (automatique au démarrage sauf si `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` ou redémarrez sans `EYAS_SKIP_DOCS_BUILD`. Paquet : `packages/docs`.

### Erreur d'authentification du fournisseur
Saisissez à nouveau la clé sous Fournisseurs / Secrets ; pour les CLI, vérifiez que `claude` / `grok` / `kimi` fonctionnent dans le même environnement.

### Où sont les données ?
`$EYAS_HOME` ou le répertoire de travail : `data/sqlite`, `data/vault`, `data/agents`, sauvegardes, journaux.

### Assistant bloqué après rechargement
Connectez-vous en tant que propriétaire, ouvrez `/setup` pour les étapes facultatives restantes.
