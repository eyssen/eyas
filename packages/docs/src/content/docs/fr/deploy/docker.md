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

## Voir aussi

- [Natif](/docs/fr/deploy/native/)
- [Kubernetes](/docs/fr/deploy/kubernetes/)
- [Plusieurs instances](/docs/fr/deploy/multi-instance/)
