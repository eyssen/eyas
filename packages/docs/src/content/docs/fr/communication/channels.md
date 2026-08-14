---
title: Vue d’ensemble des canaux
description: Instances de canaux, modes, liaison d’agents, file d’entrée, appariement.
---

**Route :** `/communication` → onglets **Canaux · File d’entrée · Appariement**.

Sous-titre : *Connectez des canaux de messagerie et associez-les à votre agent principal.*

## Plusieurs instances

Vous pouvez exécuter **plusieurs comptes du même type** (p. ex. deux bots Telegram), chacun avec ses propres identifiants et son agent. Utilisez **Ajouter une instance** ou **Ajouter une instance …** sur une carte.

## Créer une instance

| Champ | Signification |
|-------|---------------|
| **Type de canal** | Modèle (Telegram, Signal, …) |
| **Nom affiché** | p. ex. Signal travail, Telegram personnel |
| **Créer et connecter** | Créer l’instance et démarrer le flux de connexion |
| **Supprimer l’instance** | Retirer l’instance et ses identifiants (confirmation) |

## État de l’instance

| État | Signification |
|------|---------------|
| **Connecté** | Connexion active |
| **Déconnecté** | Non connecté |
| **Identifiants définis** | Secrets stockés, peut nécessiter Connecter |
| **Non configuré** | Secrets manquants |
| **Erreur** | Dernière erreur |
| Santé **Conflit / Erreur d’authentification / Dégradé** | Santé opérationnelle |

## Mode

| Mode | Signification |
|------|---------------|
| **Autonome** | S’exécute sans surveillance ; l’échelle d’autonomie progressive contrôle encore les actions |
| **Géré** | La porte de sécurité régit chaque appel d’outil |

Un clic bascule entre les modes (des infobulles expliquent chacun).

## Identifiants et liaison d’agent

| Champ | Signification |
|-------|---------------|
| Champs secrets | Spécifiques au canal (voir les sections Telegram / Signal) |
| *Laissez vide pour conserver la valeur actuelle* | Espace réservé lors de l’édition |
| Badge **défini** | Secret déjà stocké |
| **Agent pour les messages entrants** | Quel agent répond ; assistant principal par défaut |
| **— aucun (messages stockés, pas de réponse automatique) —** | Stockage uniquement |
| **Agent lié** | Agent actuellement lié |
| **Enregistrer et connecter** | Enregistrer les secrets et connecter |
| **Tester / Connecter / Déconnecter / Reconnecter / Configurer** | Actions de cycle de vie |

## Onglet File d’entrée

Messages entrants en file en attente de traitement / affichage (horodatages du type *il y a Ns/Nmin/Nh*).

## Onglet Appariement

Les canaux qui exigent un **appariement** (p. ex. les messages privés Telegram) affichent un badge **Appariement**. Approuvez ici les codes d’appariement avant que les messages privés fonctionnent.

## Voir aussi

- [Telegram](/docs/fr/communication/telegram/)
- [Agents — onglet canaux](/docs/fr/agents/configure/)
