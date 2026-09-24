---
title: Vue d'ensemble des paramètres
description: Centre système — apparence, langue, cartes, liens.
---

**À quoi ça sert.** La page **Système** (`/settings`) est le centre des paramètres : statistiques, informations système, apparence et langue, affectations de modèles, la liste du Mode Dieu, et les groupes de la barre latérale qui ouvrent toutes les autres surfaces d’administration. [Notifications](/docs/fr/admin/notifications/), [Extensions](/docs/fr/admin/extensions/), [Nœuds distants](/docs/fr/admin/nodes/) et [Mains](/docs/fr/admin/hands/) sont des pages à part, liées depuis la barre latérale — elles ne sont pas hébergées ici.

**Route :** `/settings` (barre latérale **Système**).

## Statistiques

**Fournisseurs** (actifs / total) · **Modèles** (activés / total) · **Secrets** (chiffrés) · **Utilisateurs** (enregistrés).

## Résumé des fournisseurs

La liste des fournisseurs avec un indicateur d’activité et le nombre de modèles activés / au total. Les noms sont les mêmes noms de produit que sur la page Fournisseurs (où se trouve la configuration complète).

## Informations système

| Champ | Signification |
|-------|---------------|
| **Version** | Version d’EYAS |
| **État** | Santé |
| **Environnement d'exécution** | Bun |
| **Base de données** | SQLite (WAL) |

## Cartes de cette page

| Carte | Rôle |
|-------|------|
| **Mises à jour** | Rechercher et appliquer les mises à jour depuis GitHub |
| **Portabilité des données** | Assistant d’import ([Import et export de données](/docs/fr/admin/data-port/)) |
| **Apparence** | **Thème** (clair/sombre), **Langue** (en / hu / de / es / fr / tlh) et **Gabarits** |
| **Affectations de modèles** | Choix par agent, chacun affiché et enregistré sous la forme *Fournisseur / modèle*, si bien qu’un identifiant de modèle que listent deux fournisseurs n’est jamais ambigu. Voir [Routage et budget — Affectations de modèles](/docs/fr/ai/routing-budget/#model-assignments). L’étape Modèles d’IA de l’assistant de configuration suit les mêmes règles |
| **Mode Dieu** | Liste de 2 à 5 modèles en course sur la même tâche, plus le président, le plafond de coût et la conservation des dossiers de travail. Voir [Conversations — Mode Dieu](/docs/fr/daily/conversations/). |
| **Agents d'équipe** | Sélection des spécialistes |
| **Autonomie et auto-amélioration** | Les boucles d’auto-amélioration en arrière-plan, toutes désactivées par défaut — voir [Autonomie](/docs/fr/agents/autonomy/) |

## Groupes de paramètres de la barre latérale

| Groupe | Liens |
|--------|-------|
| **Général** | Système, Utilisateurs, Clés API, Secrets, [Connexions](/docs/fr/admin/connections/) (`/connections`) |
| **IA et modèle** | Fournisseurs, Médias, Prompts, Mémoire, Serveurs MCP |
| **Modules** | Projets, Documents, Sources de recherche, [Notifications](/docs/fr/admin/notifications/) (`/notifications-settings`), Proactif, Auto-apprentissage, [Extensions](/docs/fr/admin/extensions/) (`/extensions`) |
| **Infrastructure** | [Mains](/docs/fr/admin/hands/) (`/hands`), [Ingress](/docs/fr/admin/ingress/), [Nœuds](/docs/fr/admin/nodes/) (`/nodes`), Sauvegarde, Réunions |

## Voir aussi

- [Fournisseurs](/docs/fr/ai/providers/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Connexions](/docs/fr/admin/connections/)
- [Notifications](/docs/fr/admin/notifications/)
- [Extensions](/docs/fr/admin/extensions/)
- [Nœuds distants](/docs/fr/admin/nodes/)
- [Mains](/docs/fr/admin/hands/)
