---
title: Telegram
description: Jeton BotFather, liaison d’agent, étapes d’appariement.
---

## Étapes de configuration (dans le produit)

1. Ouvrez Telegram → **@BotFather**
2. `/newbot` — nom affiché + nom d’utilisateur se terminant par `bot`
3. Copiez le jeton d’API HTTP (`123456:ABC-…`)
4. Dans Communication EYAS : collez le jeton, choisissez l’agent, **Enregistrer et connecter**
5. Envoyez un message au bot → approuvez l’appariement sous **Communication → Appariement**

## Champs

| Champ | Signification |
|-------|---------------|
| **Jeton du bot fourni par @BotFather** | Jeton d’API du bot Telegram (stocké chiffré) |
| Espace réservé | Forme d’exemple du jeton |
| Indication | Où obtenir le jeton dans BotFather |
| **Agent pour les messages entrants** | Agent qui répond aux messages privés / groupes selon la configuration |

## Notes

- Appariement activé : les messages privés nécessitent d’abord une demande d’**appariement approuvée**.
- Plusieurs bots = plusieurs instances (voir [Vue d’ensemble des canaux](/docs/fr/communication/channels/)).

## Voir aussi

- [Vue d’ensemble des canaux](/docs/fr/communication/channels/)
- [Onglet Appariement](/docs/fr/communication/channels/)
