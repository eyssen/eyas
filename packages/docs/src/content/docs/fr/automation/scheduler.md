---
title: Planificateur
description: Tâches récurrentes, routines d’agent, calendrier et Gantt, et celles qui ne peuvent pas s’exécuter.
---

**À quoi ça sert.** Le planificateur est l’horloge : handlers système et routines d’agent. Tu crées des jobs, tu vois last/next, tu attrapes ceux qui ne tireront jamais. Ce n’est pas le Tableau.

**Route :** `/scheduler`. Barre : **Planificateur**.

## Quand l'utiliser

- Un agent doit lancer un prompt chaque matin sans conversation.
- Sauvegarde en cron, last/next visible.
- Un job est à l’arrêt — badge **Pas de handler / Ne se déclenche jamais / Non planifié**.
- Leadership de cluster, overdue, dead-letter.

## Déroulement typique

1. **Planificateur** (`/scheduler`).
2. **Liste / Gantt / Calendrier**. Zoom **Jour / Semaine / Mois**.
3. **Créer une tâche** — type **Handler système** / **Routine d’agent**, déclencheur **Cron / Intervalle / Événement**.
4. Bandeau santé. Badge cannot-run : survol pour la cause.
5. **Exécuter maintenant** (seul chemin pour Événement). **Pause / Reprendre**, **Replanifier**.

Cron invalide ou intervalle &lt; 1 s refusé à la création. **Événement** accepté mais ne tire pas tout seul — **Ne se déclenche jamais**. **Afficher les tâches d’infrastructure** ne cache pas un job cassé.

## Voir aussi

- [CLI / config](/docs/fr/deploy/configuration/)
- [Agents](/docs/fr/agents/overview/)
- [Sauvegarde](/docs/fr/admin/backup/)
- [Accueil](/docs/fr/daily/home/)
