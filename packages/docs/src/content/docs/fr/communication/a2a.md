---
title: A2A et agents externes
description: Protocole agent-à-agent — agent card, tâches entrantes, fédération optionnelle.
---

**À quoi ça sert.** A2A est la façon dont un autre runtime d’agents découvre cette EYAS et lui remet une tâche — pas une personne sur Telegram, pas une [Main](/docs/fr/admin/hands/). Agent Card : `/.well-known/agent-card.json`. `tasks/send` crée une conversation et exécute `executeAgent`. La fédération de pairs existe en API ; **pas** d’onglet Communication.

## Quand l'utiliser

- Un client A2A doit découvrir cette instance et envoyer des tâches.
- EYAS derrière [Ingress](/docs/fr/admin/ingress/) — URL well-known et schéma d’auth.
- Deux instances EYAS fédérées (`/api/v1/federation/peers`).

## Déroulement typique

1. Décide la frontière de confiance. Seulement avec une exposition réseau volontaire, derrière auth/ingress.
2. `GET /.well-known/agent-card.json` (`authentication.schemes` par défaut `bearer`).
3. Le pair envoie `tasks/send` — conversation + `executeAgent`.
4. Optionnel : `POST /api/v1/federation/peers`. Partage le jeton inbound une fois ; rotation `POST …/rotate-inbound`. Adresse `peerId/agentId`.

Compétences par défaut sur la card : `research`, `code-review`. Le catalogue de canaux exclut MCP/A2A comme cartes de chat.

## Voir aussi

- [Ingress](/docs/fr/admin/ingress/)
- [Canaux](/docs/fr/communication/channels/)
- [Agents](/docs/fr/agents/overview/)
- [Outils](/docs/fr/automation/tools/)
