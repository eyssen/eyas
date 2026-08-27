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

Une expression cron non valide ou un intervalle inférieur à une seconde est refusé lorsque vous appuyez sur **Créer**, avec le motif affiché sur le formulaire : *« Cette planification est invalide, la tâche ne s'exécuterait jamais. Vérifiez l'expression cron ou l'intervalle. »* Auparavant, une telle tâche était créée mais ne s'exécutait jamais, sans avertissement. Un déclencheur **Événement** est toujours accepté, mais une telle tâche ne peut pas se déclencher seule pour l'instant — elle est créée avec l'étiquette **Ne se déclenche jamais** (voir ci-dessous).

## Types de tâches

| Type | Signification |
|------|---------------|
| **Handler système** | Handler intégré de maintenance / automatisation |
| **Routine d’agent** | Exécute un agent avec un prompt selon un planning |

## Actions et statistiques d’une ligne

| Contrôle | Signification |
|----------|---------------|
| **En pause / En cours** | État d’activation de la tâche |
| **Étiquette « impossible d’exécuter »** | Affichée sur la ligne comme **Aucun handler**, **Ne se déclenche jamais**, ou **Non planifiée** — aucun handler enregistré (son module est probablement désactivé), un type de déclencheur qui ne se déclenche jamais seul (Événement), ou une planification qui n’a pas pu être activée (cron invalide, ou intervalle inférieur à une seconde). Survolez pour connaître la cause. |
| **Dernière / Prochaine** | Dernière et prochaine heures de déclenchement |
| **N exécutions / N échecs** | Compteurs |
| **Exécuter maintenant** | Déclencher immédiatement ; désactivé uniquement lorsque la tâche n’a aucun handler enregistré, ou qu’elle est désactivée / en dead-letter, avec le motif dans l’infobulle. Une tâche portant l’étiquette **Ne se déclenche jamais** ou **Non planifiée** peut tout de même être exécutée ainsi — pour une tâche Événement, c’est le seul moyen de l’exécuter |
| **Mettre en pause / Reprendre** | Basculer |
| **Replanifier** + **Appliquer** | Modifier le planning ; une expression cron invalide ou un intervalle inférieur à une seconde est refusé et le motif s’affiche sous le champ |
| **Supprimer** | Retirer la tâche et son historique (confirmation) |
| **Agent assigné** | Nom de l’agent pour les routines |
| Rechercher | Filtrer la liste |
| **Afficher les tâches d’infrastructure** | Inclure les tâches d’infrastructure internes |

**Afficher les tâches d’infrastructure** ne masque jamais une tâche qui ne peut pas s’exécuter — une tâche système défaillante reste visible même lorsque le filtre est désactivé.

## Exécutions récentes

Liste des exécutions passées — heure de début, durée et qui a déclenché chacune d’elles (`system` lorsqu’une minuterie l’a déclenchée, un agent, ou un identifiant d’utilisateur) ; vide : *Aucune exécution pour le moment.*

## Bandeau de santé

| Indicateur | Signification |
|------------|---------------|
| **Leader / Suiveur** | Leadership de cluster (multi-instance) |
| **N actifs** | Tâches actives |
| **N en cours** | En cours d’exécution |
| **N échecs (24 h)** | Échecs de la dernière journée |
| **N dead-letter** | Tentatives épuisées |
| **N en retard** | Planning manqué |
| **N ne peuvent pas s’exécuter** | Tâches qui ne s’exécuteront pas telles que configurées |

## Légende (chronologie)

passé · en cours · prochain · futur · exécutions · échéance

## Voir aussi

- [CLI / configuration](/docs/fr/deploy/configuration/)
- [Agents](/docs/fr/agents/overview/)
