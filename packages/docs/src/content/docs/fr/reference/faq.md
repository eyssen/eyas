---
title: FAQ
description: Problèmes courants.
---

### Port occupé
`EYAS_PORT=3200 ./bin/eyas start` ou libère le processus.

### L’UI n’est pas sur le port 3000
Le port d’écoute par défaut est **3100**, pour ne pas coincer Grafana ou Create React App sur :3000. Ouvre **http://localhost:3100**. Override : `EYAS_PORT` ou `server.port`. Docker : `"${EYAS_PORT:-3100}:3100"`.

### Pas d’UI
`bun run build:web` (auto au démarrage sauf `EYAS_SKIP_WEB_BUILD=1`).

### /docs 404
`bun run docs:build` ou redémarre sans `EYAS_SKIP_DOCS_BUILD`. Paquet : `packages/docs`. Ne lance pas `generate-full-docs.mjs` / `bun run full-docs` — ça écrase la prose.

### Erreur d’auth fournisseur
Ré-entre la clé sous Fournisseurs/Secrets ; pour les CLI, `claude`/`grok`/`kimi` doivent marcher dans le même environnement.

### Les conversations lisent ~/.claude / ~/.grok
Claude Code CLI : laisse **Charger la config Claude de l’hôte** **OFF** (défaut). Les appels isolés posent aussi `CLAUDE_CODE_DISABLE_AUTO_MEMORY`. Grok/Kimi ACP **ne peuvent pas** être isolés. Voir [Fournisseurs](/docs/fr/ai/providers/).

### Des notes durables s’écrivent et je veux ça off
`memory.capture.enabled: false` dans `local.yaml` (défaut **true**). Off = aucune ligne `memory_capture_runs`. Voir [Mémoire](/docs/fr/knowledge/memory/) et [Configuration](/docs/fr/deploy/configuration/).

### Où sont les données ?
`$EYAS_HOME` ou cwd : `data/sqlite`, `data/vault`, `data/agents`, sauvegardes, logs.

### L’assistant bloque après reload
Connecte-toi en propriétaire, ouvre `/setup` pour les étapes optionnelles restantes.
