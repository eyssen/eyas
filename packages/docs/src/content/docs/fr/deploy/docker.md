---
title: Docker
description: Compose un conteneur (plus Ollama GPU optionnel). Port 3100. Persiste data/.
---

**À quoi ça sert.** Deuxième chemin : un service `eyas`, volume `data/`, profil **gpu** optionnel pour Ollama. Quand Docker est déjà là et que tu ne veux pas Bun sur l’hôte. L’image inclut backend, frontend dist et docs sous `/docs/`. Le conteneur écoute sur **3100**.

## Quand l'utiliser

- Le serveur a déjà Docker.
- Un second stack (`-p eyas-dev` + `EYAS_PORT=3200`).
- Ollama local avec NVIDIA (`--profile gpu`).

## Déroulement typique

1. Clone. `.env` optionnel.
2. `docker compose up -d`. **http://localhost:3100**.
3. Volume `eyas-data`. `./config` en lecture seule.
4. `docker compose logs -f` / `down`.
5. GPU : `docker compose --profile gpu up -d`.

Mapping `"${EYAS_PORT:-3100}:3100"` — 3100 pour ne pas coincer Grafana/CRA sur :3000. Voir [Plusieurs instances](/docs/fr/deploy/multi-instance/).

## Claude Code dans un conteneur

L’image ne contient pas la CLI Claude Code. Sans elle, EYAS se rabat sur l’ancienne copie embarquée dans sa dépendance Agent SDK (actuellement 2.1.89) et `eyas doctor` le signale. Pour faire tourner un Claude Code à jour, installe-le dans une image dérivée ou monte-le, et règle `EYAS_CLAUDE_CODE_BIN` sur son chemin absolu. Connecte-toi avec `ANTHROPIC_API_KEY` ou un login provisionné : le fournisseur n’est disponible qu’une fois ce binaire connecté. Voir [Fournisseurs — Runtime Claude Code](/docs/fr/ai/providers/#claude-code-runtime).

## Grok et Kimi dans un conteneur

Grok CLI et Kimi Code CLI tournent dans le home propre à EYAS, dans le volume de données (`data/cli-homes/…`) : ils sont donc connectés **pour EYAS**, pas avec un login intégré à l’image. Utilise **Se connecter avec un code d’appareil** sur le panneau du fournisseur : EYAS affiche un lien et un code, et tu le confirmes dans un navigateur sur n’importe quel autre appareil — aucun navigateur n’est nécessaire dans le conteneur. Grok accepte aussi une clé API xAI, stockée dans Secrets. Les connexions vivent dans le volume `eyas-data` et survivent aux redémarrages du conteneur. Pour un binaire qui n’est pas sur le PATH du conteneur, indique-le avec `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`. Voir [Fournisseurs — Connecter Grok et Kimi pour EYAS](/docs/fr/ai/providers/#sign-in-grok-and-kimi-for-eyas).

## Sandbox de fichiers du noyau dans un conteneur

L’image EYAS n’inclut **pas** bubblewrap : il est sous LGPL, l’installer est donc ton choix. Sans lui, les propres outils des fournisseurs CLI (le shell de Claude Code, les outils de Grok CLI) tournent sans le sandbox de fichiers du noyau ; EYAS refuse toujours chaque requête qu’il voit, le panneau du fournisseur affiche le sandbox comme *Indisponible sur ce serveur*, et avec `security.cliSandbox: required` les tours CLI avec outils sont refusés. Pour avoir la couche noyau, installe bubblewrap (`bwrap`) — plus `socat` pour Claude Code — dans une image dérivée, et lance le conteneur avec les espaces de noms utilisateur non privilégiés activés. `eyas doctor` (`docker compose exec eyas eyas doctor`) affiche le résultat sur sa ligne **CLI sandbox**. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox).

## Fuseau horaire

Les conteneurs tournent en général en UTC. La date et l’heure qu’EYAS donne au modèle suivent `i18n.timezone`, sinon le `TZ` du conteneur — voir [Configuration — Fuseau horaire](/docs/fr/deploy/configuration/#time-zone-of-the-models-clock).

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Kubernetes](/docs/fr/deploy/kubernetes/)
- [Plusieurs instances](/docs/fr/deploy/multi-instance/)
