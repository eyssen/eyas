---
title: Planification
description: Tâches, déclencheurs, vues, santé — chaque champ.
---

**Route :** `/scheduler`. Sous-titre : *Tâches récurrentes, routines d’agents et historique des exécutions.*

## Vues

| Vue | Signification |
|-----|---------------|
| **Liste** | Tableau des tâches |
| **Gantt** | Barres de chronologie |
| **Calendrier** | Disposition calendrier |
| Zoom **Jour / Semaine / Mois** | Échelle Gantt / calendrier |

## Créer une tâche

| Champ | Signification |
|-------|---------------|
| **Nom de la tâche** | Nom affiché |
| **Handler** | Identifiant de handler système (p. ex. `backup.run`) ou choix dans la liste |
| **Type de déclencheur** | **Cron** · **Intervalle** · **Événement** |
| **Planification (cron)** | Expression cron lorsque le type est Cron |
| **Intervalle (ms)** | Période lorsque le type est Intervalle |
| **Nom de l’événement** | Événement du bus lorsque le type est Événement (p. ex. `conversation.completed`) |
| **ID de l’agent** | Pour les routines d’agent |
| **Prompt** | Texte du prompt pour les tâches agent_run |
| **Créer** | Enregistrer la tâche |

## Types de tâches

| Type | Signification |
|------|---------------|
| **Handler système** | Handler intégré de maintenance / automatisation |
| **Routine d’agent** | Exécute un agent avec un prompt selon un planning |

## Actions et statistiques d’une ligne

| Contrôle | Signification |
|----------|---------------|
| **En pause / En cours** | État d’activation de la tâche |
| **Dernière / Prochaine** | Dernière et prochaine heures de déclenchement |
| **N exécutions / N échecs** | Compteurs |
| **Exécuter maintenant** | Déclencher immédiatement |
| **Mettre en pause / Reprendre** | Basculer |
| **Replanifier** + **Appliquer** | Modifier le planning |
| **Supprimer** | Retirer la tâche et son historique (confirmation) |
| **Agent assigné** | Nom de l’agent pour les routines |
| Rechercher | Filtrer la liste |
| **Afficher les tâches d’infrastructure** | Inclure les tâches d’infrastructure internes |

## Exécutions récentes

Liste des exécutions passées ; vide : *Aucune exécution pour le moment.*

## Bandeau de santé

| Indicateur | Signification |
|------------|---------------|
| **Leader / Suiveur** | Leadership de cluster (multi-instance) |
| **N actifs** | Tâches actives |
| **N en cours** | En cours d’exécution |
| **N échecs (24 h)** | Échecs de la dernière journée |
| **N dead-letter** | Tentatives épuisées |
| **N en retard** | Planning manqué |

## Légende (chronologie)

passé · en cours · prochain · futur · exécutions · échéance

## Voir aussi

- [CLI / configuration](/docs/fr/deploy/configuration/)
- [Agents](/docs/fr/agents/overview/)
