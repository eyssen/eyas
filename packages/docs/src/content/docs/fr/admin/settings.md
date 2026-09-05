---
title: Vue d'ensemble des paramètres
description: Hub système — apparence, langue, cartes, liens.
---

**À quoi ça sert.** Paramètres (`/settings`) est le hub système : apparence, langue, affectations de modèles, liste Mode Dieu, et les groupes de la barre latérale qui ouvrent les autres surfaces d'administration. Les statistiques et les infos système vivent sur cette page. [Notifications](/docs/fr/admin/notifications/), [Extensions](/docs/fr/admin/extensions/), [Nœuds distants](/docs/fr/admin/nodes/) et [Mains](/docs/fr/admin/hands/) sont des pages à part, liées depuis la barre — elles ne sont pas hébergées ici.

**Chemin :** `/settings`.

## Statistiques

Fournisseurs actifs/total · Modèles activés/total · Nombre de secrets · Nombre d'utilisateurs.

## Résumé des fournisseurs

Liste des fournisseurs avec indicateur d'activité et compteurs de modèles (configuration complète sur la page Fournisseurs).

## Informations système

| Champ | Signification |
|-------|---------------|
| **Version** | Version d'EYAS |
| **Statut** | Santé |
| **Runtime** | Bun |
| **Base de données** | SQLite (WAL) |

## Cartes de cette page

| Carte | Rôle |
|-------|------|
| **Mise à jour système** | Vérifier / appliquer les mises à jour depuis GitHub |
| **Port de données** | Assistant d'import ([Import de données](/docs/fr/admin/data-port/)) |
| **Apparence** | Modèle de thème + clair / sombre |
| **Langue** | en / hu / de / es / fr / tlh |
| **Affectations de modèles** | Choix de modèle par agent |
| **Mode Dieu** | Liste de 2 à 5 modèles qui courent la même tâche, plus président, plafond et rétention des dossiers. Voir [Conversations — Mode Dieu](/docs/fr/daily/conversations/#mode-dieu). |
| **Agents d'équipe** | Sélection des spécialistes |
| **Fonctions d'autonomie** | Indicateurs de fonctionnalités |

## Groupes de paramètres dans la barre latérale

| Groupe | Liens |
|--------|-------|
| Général | Système, Utilisateurs, Clés API, Secrets |
| IA et modèle | Fournisseurs, Invites, Mémoire, MCP |
| Modules | Projets, Documents, Sources de recherche, [Notifications](/docs/fr/admin/notifications/) (`/notifications-settings`), Proactif, Auto-apprentissage, [Extensions](/docs/fr/admin/extensions/) (`/extensions`) |
| Intégrations | [Connexions](/docs/fr/admin/connections/) (`/connections`) — inventaire des systèmes externes |
| Infrastructure | [Mains](/docs/fr/admin/hands/) (`/hands`), [Ingress](/docs/fr/admin/ingress/), [Nœuds](/docs/fr/admin/nodes/) (`/nodes`), Sauvegarde, Réunions |

## Voir aussi

- [Fournisseurs](/docs/fr/ai/providers/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Connexions](/docs/fr/admin/connections/)
- [Notifications](/docs/fr/admin/notifications/)
- [Extensions](/docs/fr/admin/extensions/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Mains](/docs/fr/admin/hands/)
