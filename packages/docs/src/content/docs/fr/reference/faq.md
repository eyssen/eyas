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
Ré-entre la clé sous Fournisseurs/Secrets. Pour Claude Code, `claude` doit être connecté dans le même environnement. Grok et Kimi se connectent pour EYAS sur le panneau de leur fournisseur, pas sur l’hôte.

### Les conversations lisent ~/.claude / ~/.grok
Plus maintenant. Claude Code tourne toujours isolé — aucun `CLAUDE.md`, réglage, hook, skill, serveur MCP ni auto-mémoire de l’hôte, et aucune transcription sous `~/.claude/projects` ; l’ancien interrupteur **Charger la config Claude de l’hôte** a disparu. Grok CLI et Kimi Code CLI tournent dans leur propre home EYAS et ne voient jamais `~/.grok`, `~/.kimi` ni `~/.claude`. Le portail de sécurité refuse, pour tous les modèles, les lectures comme les écritures de la mémoire d’autres outils, et les serveurs MCP de stockage de mémoire sont bloqués. Pour faire entrer ce savoir dans EYAS, importe-le une fois avec **Paramètres → Système → Portabilité des données → Importer des données**. Voir [Fournisseurs — Isolation de Claude Code](/docs/fr/ai/providers/#claude-code-isolation) et [Mémoire](/docs/fr/knowledge/memory/#memory-outside-eyas-is-refused).

### Grok ou Kimi ne répond plus après la mise à jour
Grok CLI et Kimi Code CLI tournent maintenant dans le home propre à EYAS : la connexion de la CLI sur l’ordinateur n’est donc pas utilisée. Connecte-toi une fois pour EYAS : **Fournisseurs → Grok CLI / Kimi Code CLI → Se connecter pour EYAS** (code d’appareil ; Grok accepte aussi une clé API xAI). D’ici là, la carte affiche **Connexion requise** et les tours échouent avec *… n’est pas connecté pour EYAS*. Voir [Fournisseurs — Connecter Grok et Kimi pour EYAS](/docs/fr/ai/providers/#sign-in-grok-and-kimi-for-eyas).

### Un tour a échoué avec « n’a pas pu confirmer qu’il s’exécute isolé »
EYAS a trouvé sur l’hôte quelque chose qui casserait l’isolation de la CLI — par exemple un serveur MCP, un hook, un plugin ou une skill en trop, une config Grok globale au système, ou une politique Claude Code gérée qui impose un autre mode de permission. Supprime la cause et renvoie le message ; le tour n’est jamais confié à un autre modèle. Voir [Fournisseurs — Vérification d’isolation](/docs/fr/ai/providers/#isolation-check-before-every-turn) et [Isolation de Claude Code](/docs/fr/ai/providers/#claude-code-isolation).

### Un serveur MCP affiche « Bloqué : stockage de mémoire »
Il conserve une seconde mémoire hors d’EYAS (Memory, Qdrant, Obsidian, MCPVault, …) ou pointe vers un dossier protégé : EYAS ne le démarre donc jamais. Modifie-le pour qu’il pointe ailleurs, ou supprime-le, et fais entrer cette mémoire avec l’import de données. Voir [MCP](/docs/fr/ai/mcp/#memory-store-servers-are-blocked).

### Claude Code est installé mais le fournisseur n’est pas disponible
EYAS exige que le binaire Claude Code soit **connecté**, pas seulement sur le PATH : login claude.ai, `ANTHROPIC_API_KEY`, ou une configuration Bedrock/Vertex. Regarde `eyas doctor` — la ligne **Claude Code runtime** montre quel binaire EYAS lance et s’il est connecté. Le PATH d’un service peut ne pas contenir `claude` ; règle `EYAS_CLAUDE_CODE_BIN` sur son chemin absolu. Après t’être connecté, éteins puis rallume le fournisseur sous Fournisseurs, ou redémarre. Voir [Fournisseurs — Runtime Claude Code](/docs/fr/ai/providers/#claude-code-runtime).

### Des notes durables s’écrivent et je veux ça off
`memory.capture.enabled: false` dans `local.yaml` (défaut **true**). Off = aucune ligne `memory_capture_runs`. Voir [Mémoire](/docs/fr/knowledge/memory/) et [Configuration](/docs/fr/deploy/configuration/).

### Où sont les données ?
`$EYAS_HOME` ou cwd : `data/sqlite`, `data/vault`, `data/agents`, sauvegardes, logs. `EYAS_DATA_DIR` déplace tout le répertoire de données ; le coffre le suit (`<répertoire de données>/vault`). Les espaces de travail des conversations d’une install depuis les sources lancée depuis un clone git vivent dans le répertoire de données d’application de ton utilisateur — voir [Configuration](/docs/fr/deploy/configuration/#conversation-workspaces).

### J’ai réglé EYAS_DATA_DIR et mes notes de mémoire ont disparu
Les versions précédentes gardaient le coffre dans `<home EYAS>/data/vault` même quand `EYAS_DATA_DIR` pointait ailleurs. Le premier démarrage après la mise à jour copie ces notes une fois dans `<répertoire de données>/vault`, mais seulement tant que le nouveau coffre ne contient aucune note. Lance `eyas doctor` : sa ligne **Vault** dit si une copie est en attente, ou si l’ancien dossier n’est plus utilisé parce que les deux contiennent des notes — copie alors à la main toute note dont tu as encore besoin. Voir [Configuration — Répertoire de données et coffre](/docs/fr/deploy/configuration/#data-directory-and-vault).

### Le modèle reçoit une heure locale fausse
Règle `i18n.timezone` (un nom IANA comme `Europe/Berlin`) dans `local.yaml` et redémarre. Non défini, EYAS utilise le fuseau du serveur — `TZ`, sinon l’OS ; les conteneurs sont en général en UTC. Voir [Configuration](/docs/fr/deploy/configuration/#time-zone-of-the-models-clock).

### L’assistant bloque après reload
Connecte-toi en propriétaire, ouvre `/setup` pour les étapes optionnelles restantes.
