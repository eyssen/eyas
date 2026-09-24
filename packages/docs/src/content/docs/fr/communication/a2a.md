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

**Pas de mémoire du propriétaire pour les pairs.** Une tâche qu’un autre agent envoie par A2A reçoit la date et l’heure actuelles, mais aucune mémoire rappelée du propriétaire n’y est poussée — le bloc de mémoire rappelée que reçoit toute exécution interne est retenu. Les outils mémoire (`memory_search` / `memory_expand`) ne changent pas et restent gouvernés par le portail de sécurité. Ce qu’un pair envoie est mémorisé comme texte *peer*, pas comme le tien. Voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model).

**Capture de mémoire sur les tâches A2A.** Une tâche A2A exécute désormais aussi la capture de mémoire durable d’EYAS, sous les mêmes réglages `memory.capture.*` qu’un tour de chat. La tâche du pair est lue comme les mots d’un tiers : elle ne crée jamais de note sur qui tu es ni de règle sur la façon dont EYAS doit travailler, seulement des notes `reference`, `project` ou `domain` stockées avec la confiance *peer* (`trust: peer`), et elle ne complète jamais une de tes propres notes. Seuls les mots du pair comptent pour `minUserChars`. Voir [Mémoire — Le capture est activé par défaut](/docs/fr/knowledge/memory/#capture-is-on-by-default).

**Modèle et effort.** Une tâche A2A tourne comme une conversation de l’agent lié : elle suit le modèle et l’effort de cet agent ; si l’agent n’a pas de modèle, le défaut de l’install est fixé sur la conversation à sa première réponse.

**Le texte du pair est encadré.** La description de la tâche arrive au modèle dans un bloc d’entrée non fiable (source `a2a`), comme les messages de canal, ses balises de contrôle neutralisées — un pair ne peut donc pas ouvrir sa tâche par un texte qui ressemble au bloc de date et d’heure ou de mémoire rappelée propre à EYAS.

## Voir aussi

- [Ingress](/docs/fr/admin/ingress/)
- [Canaux](/docs/fr/communication/channels/)
- [Agents](/docs/fr/agents/overview/)
- [Outils](/docs/fr/automation/tools/)
