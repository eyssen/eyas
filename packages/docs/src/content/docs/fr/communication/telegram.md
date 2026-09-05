---
title: Telegram
description: Jeton BotFather, coffre de secrets, liaison d’agent et appariement des DM.
---

**À quoi ça sert.** Telegram est le canal de chat de première classe : un bot BotFather dont les DM (après appariement) exécutent un agent EYAS lié. Le secret va dans le coffre, pas dans le YAML.

**Route :** `/communication` → **Canaux** → Telegram. Appariement : **Communication → Appariement**.

## Quand l'utiliser

- Écrire à l’assistant depuis le téléphone.
- Un second bot (travail vs perso) comme autre instance.
- Les DM sont ignorés — l’appariement n’est pas encore approuvé.
- Un outil jaune ou rouge attend et vous voulez **Approuver** / **Refuser** dans Telegram.
- Un nouveau fil depuis le même chat (`/new` ou `/start`).

## Déroulement typique

1. Telegram → **@BotFather** → `/newbot`.
2. Copie le jeton HTTP API.
3. Dans EYAS colle-le, choisis **Agent pour les messages entrants**, **Enregistrer et connecter**.
4. Écris au bot. Approuve le code sous **Appariement**.
5. Les DM suivants de cet expéditeur continuent la même conversation. Un champ jeton vide conserve la valeur stockée. `/new` ou `/start` ouvre un nouveau fil.

Champ : **Jeton de bot @BotFather** (chiffré, clé `telegram-bot-token`). Badge **Appariement**. Plusieurs bots = plusieurs instances.

Après appariement, le **premier message** crée une conversation ; les suivants la poursuivent. `/new`, `/start` et `/new@bot` relâchent le mapping — le bot répond *Started a new conversation. Send a message to begin.* La commande slash **n’est pas** envoyée au modèle.

Outil jaune/rouge : ping Telegram **Approve** / **Deny** vers le chat de la conversation (sinon un appariement approuvé). Même chemin `decide()` que [l’Autonomie](/docs/fr/agents/autonomy/). Le ping nomme l’outil et un motif court — **jamais** d’arguments bruts.

## Voir aussi

- [Canaux](/docs/fr/communication/channels/)
- [Secrets](/docs/fr/admin/secrets/)
- [Agents — canaux](/docs/fr/agents/configure/)
- [Autonomie](/docs/fr/agents/autonomy/)
