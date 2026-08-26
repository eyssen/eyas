---
title: Tableau
description: Tableau de travail — vues kanban, liste, chronologie, graphe, tableau de bord et chaque commande.
---

**Route :** `/board`. Suit les conversations comme des cartes à travers projets et étapes.

## Filtre de projet

| Commande | Signification |
|----------|---------------|
| **Tous les projets** | Afficher les cartes de tous les projets |
| Sélecteur de projet | Restreindre à un projet |
| Vide : *Aucun projet pour le moment* | Créez d’abord un projet ([Projets](/docs/fr/daily/projects/)) |

## Nouvelle conversation

| Commande | Signification |
|----------|---------------|
| **Nouveau** | Commencer à créer une carte / conversation |
| **Titre de la conversation…** | Titre de la nouvelle conversation |

## Vues

| Vue | Ce que vous voyez |
|-----|-------------------|
| **Kanban** | Colonnes par étape (ou regroupement) ; glisser-déposer |
| **Liste** | Lignes tabulaires avec actions de tri / filtre |
| **Chronologie** | Fenêtres temporelles d’activité et d’échéances |
| **Graphe** | Graphe d’orchestration ou de flux d’étapes |
| **Tableau de bord** | Métriques agrégées du tableau |

### Grouper par (kanban)

| Option | Signification |
|--------|---------------|
| **Étape** | Colonnes = étapes du pipeline |
| **Priorité** | Colonnes = priorité |
| **Assigné** | Colonnes = assigné (seau **Non assigné**) |

## Champs / badges de carte

| Badge / champ | Signification |
|---------------|---------------|
| **Titre** | Titre de la conversation (*Sans titre* si vide) |
| **Épinglé** | Épinglé à la bande d’épingles du Tableau / Accueil |
| Statut **Au travail** | Agent actuellement au travail |
| Statut **En attente** | En attente d’une réponse |
| Statut **Approbation** | En attente d’approbation |
| Statut **Erreur** | Exécution échouée |
| **N/M** sous-tâches | Sous-tâches faites / totales |
| **N% contexte** | Indication d’utilisation de la fenêtre de contexte |
| **Date en retard** | Échéance dépassée |
| **$coût** | Dépense attribuée à la carte |
| Vieillissement **Nh / Nj / bloqué** | Temps depuis la mise à jour / durée de blocage |

## Commandes de colonne

| Commande | Signification |
|----------|---------------|
| **Replier la colonne** | Replier l’interface de la colonne |
| **Déposer ici** | Cible de dépôt pendant le glisser |
| **WIP n/limite** | Nombre de travaux en cours vs limite |

## Filtres

| Filtre | Signification |
|--------|---------------|
| **Étape** | Filtre d’étape |
| **Priorité** | Filtre de priorité |
| **Étiquettes** | Filtre d’étiquettes |
| État **Actif / Terminé / Tout** | État du cycle de vie |
| **Nom…** | Recherche par titre |
| **Contenu…** | Plein texte dans le contenu |

### Valeurs de priorité

**Urgent · Haute · Normale · Basse**

## Colonnes / actions de la vue Liste

| Colonne / action | Signification |
|------------------|---------------|
| **P** | Priorité |
| **ID** | Identifiant |
| **Titre** | Titre |
| **Projet** | Projet |
| **Mis à jour** | Dernière mise à jour (temps relatif) |
| **Épingler** | Épingler / désépingler |
| **Archiver** | Archiver la conversation |
| Toast de suppression + **Annuler** | Suppression douce avec annulation |

## Bande d’épingles

| Libellé | Signification |
|---------|---------------|
| **Actif** | Ensemble épinglé |
| Icônes de statut | Au travail / En attente de réponse / En attente d’approbation / Erreur |

## Commandes de chronologie

| Commande | Signification |
|----------|---------------|
| Fenêtre **1h / 24h / 7j / 30j** | Plage de temps visible |
| **Maintenant** | Marqueur de l’heure actuelle |
| **Exécutions d’agents** | Événements d’exécution |
| **Échéance** | Marqueurs d’échéance |
| **Mis à jour** | Événements de mise à jour |

## Métriques du tableau de bord du Tableau

| Métrique | Signification |
|----------|---------------|
| **Tâches ouvertes** | Non terminées |
| **Terminées aujourd’hui** | Achevé aujourd’hui |
| **En cours** | WIP actif |
| **En exécution** | Exécutions d’agents en direct |
| **En attente d’approbation** | File d’approbation |
| **Achevées aujourd’hui** | Débit aujourd’hui |
| **Coût aujourd’hui** | Dépense |
| **Débit** | Taux d’achèvement |
| **Activité** | Graphique d’activité |
| **En cours maintenant** | Liste en direct |
| **Mix de priorités** | Répartition |
| **Tâches par étape** | Comptes par étape |
| **En direct / Déconnecté** | Santé du lien temps réel |

## Vue graphe

| Commande | Signification |
|----------|---------------|
| Mode **Orchestration** | Graphe d’exécution multi-agent |
| Mode **Flux d’étapes** | Graphe de transition d’étapes |
| Sélecteur **Exécution d’orchestration** | Quelle exécution visualiser |

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Projets](/docs/fr/daily/projects/)
- [Accueil](/docs/fr/daily/home/)
