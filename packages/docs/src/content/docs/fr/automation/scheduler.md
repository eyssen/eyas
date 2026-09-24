---
title: Planificateur
description: Tâches récurrentes, routines d'agents, calendrier et Gantt, et tâches qui ne peuvent pas s'exécuter.
---

**À quoi ça sert.** Le planificateur est l'horloge : des handlers système récurrents (sauvegarde, maintenance) et des routines d'agents (un agent avec un prompt sur un cron). Vous créez des tâches, voyez quand elles ont tourné pour la dernière fois et repérez celles qui ne se déclencheront jamais. Ce n'est pas le Tableau — le Tableau suit des éléments de travail ; cette page suit des minuteries.

**Chemin :** `/scheduler`. Titre : **Planification**. Sous-titre : *Tâches récurrentes, routines d'agents et historique des exécutions.* Barre latérale : **Planificateur**.

## Quand l'utiliser

- Vous voulez qu'un agent exécute un prompt chaque matin sans ouvrir de conversation.
- Une sauvegarde ou un autre handler système doit se déclencher sur un cron, et vous voulez voir la dernière/prochaine exécution.
- Une tâche reste inactive et il vous faut le badge **Aucun handler / Ne se déclenche jamais / Non planifiée**, pas un raté silencieux.
- Une routine doit raisonner plus à fond (ou à moindre coût) que son agent d'habitude — réglez son **Effort**.
- Vous vérifiez la direction du cluster, les tâches en retard ou le dead-letter sur une installation à plusieurs instances.

## Déroulement typique

1. Ouvrez **Planificateur** dans la barre latérale (`/scheduler`).
2. Choisissez **Liste**, **Gantt** ou **Calendrier**. Sur les vues chronologiques, zoomez avec **Jour / Semaine / Mois**.
3. **Créer une tâche** — choisissez **Handler système** ou **Routine d'agent**, remplissez **Nom** et **Planification (cron)**, puis le **Handler**, ou pour une routine d'agent l'**ID de l'agent**, le **Prompt** et éventuellement l'**Effort** — puis **Créer**.
4. Surveillez la bande de santé. Un badge **ne peut pas s'exécuter** signifie que la tâche ne s'exécutera pas telle qu'elle est configurée ; survolez-le pour la cause.
5. **Exécuter maintenant** la déclenche immédiatement (la seule façon pour une tâche Événement de tourner). **Mettre en pause / Reprendre** modifient la tâche active ; cliquez sur une tâche pour la **Replanifier** ou changer son **Effort**.

## Fonctions

Trois vues partagent les mêmes tâches : un tableau, un Gantt de barres passées/prochaines et un calendrier. **Afficher les tâches d'infrastructure** inclut les tâches internes d'infrastructure, mais ne masque jamais une tâche qui ne peut pas s'exécuter — une tâche système cassée reste visible même filtre désactivé.

**Planifications.** Une tâche se déclenche sur une expression cron, un intervalle fixe ou un événement du bus. Le formulaire accepte une expression cron ou l'un des raccourcis `hourly`, `daily` (09:00), `weekdays` (du lundi au vendredi à 09:00), `weekly` (lundi 09:00) et `monthly` (le 1er, 09:00). Un déclencheur par intervalle ou par événement se règle via l'API ou l'outil `schedule_create` ; **Replanifier** transforme une tâche en tâche à intervalle si vous saisissez un nombre entier de millisecondes. L'icône de la ligne indique le type de déclencheur.

<h3 id="agent-routines-run-in-a-conversation">Les routines d'agent s'exécutent dans une conversation</h3>

Chaque exécution d'une routine d'agent (type **Routine d'agent**, ou une tâche créée avec l'outil `schedule_create`) crée une conversation et y lance l'agent choisi comme exécution supervisée et autonome en arrière-plan — le même exécuteur que celui des cartes du tableau et des nouvelles tentatives : le modèle propre de l'agent, le rappel complet de la mémoire EYAS à partir du prompt de la tâche, les designs joints, les documents, la capture de mémoire durable et le critique de complétude. Les outils sensibles passent par l'échelle d'[autonomie](/docs/fr/agents/autonomy/).

- La conversation appartient à l'utilisateur qui a créé la tâche ; si un agent ou le système l'a créée, au propriétaire. Son titre est le nom de la tâche, ou *Scheduled: &lt;prompt&gt;*.
- **Exécutions récentes**, dans le panneau de détail de la tâche, affiche un lien **Ouvrir la conversation** pour chaque exécution, y compris celles qui ont échoué.
- Une exécution qui ne peut pas démarrer fait échouer cette exécution avec une raison qui commence par un code : `agent_unavailable` (agent absent ou désactivé), `over_budget`, `invalid_config`, `conversation_busy`, `conversation_forbidden`, `runner_unavailable`, `owner_unavailable`. Les échecs comptent dans la limite d'échecs consécutifs / dead-letter de la tâche.
- **Effort.** Une routine d'agent peut avoir son propre **Effort** (voir [Créer une tâche](#create-job)). Chaque exécution écrit l'effort de la tâche sur sa conversation d'exécution : la puce d'effort de la réponse affiche donc le niveau de la tâche avec l'origine *conversation*. Une tâche sur **Automatique** n'écrit rien : l'exécution prend l'effort de l'agent (origine *collègue*), sinon le défaut du modèle. Le niveau est ajusté au modèle sur lequel l'exécution aboutit.

**Note de mise à jour.** Les routines d'agent créées quand les exécutions planifiées d'agents ne fonctionnaient pas encore échouaient à chaque exécution. Après la mise à jour, elles commencent à s'exécuter — et à consommer des tokens — à leur prochain déclenchement. Vérifiez-les ou mettez-les en pause avant.

**Avancé (API uniquement).** Un `handlerConfig` avec `conversationPolicy: 'reuse'` et un `conversationId` relance la tâche dans cette conversation, avec le nouveau prompt comme objectif ; la conversation doit appartenir au même utilisateur et ne pas être en cours. Avec `reuse`, la tâche règle l'effort de cette conversation à chaque exécution ; avec Automatique, un niveau laissé à la main ou par une exécution précédente est effacé. Créer ou modifier une routine d'agent dont le `handlerConfig` n'a pas d'`agentId` ou de `prompt`, n'est pas du JSON valide ou porte un `effort` invalide est refusé avec `400`. `effort` vaut `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, ou `auto`/null (l'effort de l'agent). Le créateur de la tâche est toujours l'utilisateur connecté ; un `createdBy` dans le corps de la requête est ignoré.

Une expression cron invalide ou un intervalle de moins d'une seconde est refusé — à **Créer**, à **Replanifier** et via l'API — avec la raison dans le formulaire : *« Cette planification est invalide, la tâche ne s'exécuterait jamais. Vérifiez l'expression cron ou l'intervalle. »* Un déclencheur **Événement** est accepté, mais une telle tâche ne peut pas encore se déclencher d'elle-même — elle reçoit le badge **Ne se déclenche jamais**.

## Champs et contrôles

<h2 id="views">Vues</h2>

| Vue | Signification |
|-----|---------------|
| **Liste** | Tableau des tâches |
| **Gantt** | Barres chronologiques |
| **Calendrier** | Vue calendrier |
| Zoom **Jour / Semaine / Mois** | Échelle du Gantt/calendrier |

<h2 id="create-job">Créer une tâche</h2>

**Créer une tâche** ouvre le formulaire **Nouvelle tâche planifiée** :

| Champ | Signification |
|-------|---------------|
| **Handler système** / **Routine d'agent** | Le type de tâche |
| **Nom** | Nom affiché ; les conversations d'exécution d'une routine d'agent portent ce titre |
| **Planification (cron)** | Expression cron ou raccourci (`hourly`, `daily`, `weekdays`, `weekly`, `monthly`) ; par défaut `0 9 * * *` |
| **Handler** | Handlers système uniquement : choisissez un handler enregistré avec **Sélectionner un handler…** |
| **ID de l'agent** | Routines d'agent uniquement : l'agent à exécuter |
| **Prompt** | Routines d'agent uniquement : ce que l'agent doit faire — cela devient l'objectif de l'exécution et sa requête de rappel de mémoire |
| **Effort** | Facultatif, routines d'agent uniquement. Le même sélecteur **Effort** que sur les conversations ; il apparaît dès qu'**ID de l'agent** contient l'identifiant d'un agent existant et activé, et ne liste que les niveaux proposés par le modèle de cet agent. **Automatique** (par défaut) indique ce qu'une exécution utilisera — l'effort propre de l'agent, p. ex. *Automatique · Faible (collègue)*, sinon le défaut du modèle, p. ex. *Automatique · défaut du modèle (Moyen)*. Un niveau choisi s'applique à chaque exécution de la tâche, ajusté au niveau le plus proche que propose le modèle |
| **Créer** / **Annuler** | Enregistrer la tâche / fermer le formulaire |

<h2 id="job-kinds">Types de tâches</h2>

| Type | Signification |
|------|---------------|
| **Handler système** | Handler intégré de maintenance/automatisation |
| **Routine d'agent** | Exécute un agent avec un prompt selon une planification |

<h2 id="row-actions">Lignes de tâche et panneau de détail</h2>

| Contrôle | Signification |
|----------|---------------|
| **En pause / En cours** | État d'activation de la tâche |
| **Badge non exécutable** | Affiché sur la ligne comme **Aucun handler**, **Ne se déclenche jamais** ou **Non planifiée** — aucun handler enregistré (son module est probablement désactivé), un type de déclencheur qui ne se déclenche jamais de lui-même (Événement), ou une planification qui n'a pas pu être armée (cron invalide, ou intervalle de moins d'une seconde). Survolez-le pour la cause. |
| **Dernière : … / Prochaine : …** | Dernière et prochaine heure de déclenchement |
| **N exécutions / N échecs** | Compteurs |
| **Agent :** &lt;nom&gt; | L'agent qu'exécute une routine d'agent |
| **Exécuter maintenant** | Déclencher immédiatement ; désactivé seulement si la tâche n'a pas de handler enregistré, ou est désactivée/en dead-letter, avec la raison dans l'infobulle. Une tâche marquée **Ne se déclenche jamais** ou **Non planifiée** peut quand même être lancée ainsi — pour une tâche Événement, c'est la seule façon de la faire tourner |
| **Mettre en pause / Reprendre** | Basculer |
| **Supprimer** | Retirer la tâche + l'historique (après *Supprimer cette tâche et son historique ?*) |
| **Replanifier** + **Appliquer** (panneau de détail) | Une nouvelle expression cron ou un raccourci, ou un nombre entier de millisecondes pour un intervalle ; une planification invalide est refusée et la raison s'affiche sous le champ |
| **Effort** (panneau de détail) | Routines d'agent uniquement. Un changement est enregistré immédiatement ; si l'enregistrement échoue, *Échec de l'enregistrement* s'affiche et rien ne change |
| **Rechercher…** | Filtrer la liste |
| **Toutes les sources** / **Tous les statuts** | Limiter la liste à une source ou à un statut |
| **Afficher les tâches d'infrastructure** | Inclure les tâches internes d'infrastructure |
| **Afficher uniquement les tâches qui ne peuvent pas s'exécuter** | Filtre de la bande de santé ; **Afficher à nouveau toutes les tâches** rétablit vos filtres précédents |

<h2 id="recent-executions">Exécutions récentes</h2>

**Exécutions récentes**, dans le panneau de détail de la tâche, liste les exécutions passées — heure de début, durée et qui a déclenché chacune (*Déclenché par :* `system` quand une minuterie l'a lancée, un agent ou un identifiant d'utilisateur) et, pour une routine d'agent, un lien **Ouvrir la conversation** vers la conversation de l'exécution (y compris en cas d'échec). Vide : *Aucune exécution pour le moment.*

<h2 id="health">Bande de santé</h2>

| Indicateur | Signification |
|------------|---------------|
| **Leader / Suiveur** | Direction du cluster (plusieurs instances) |
| **N actifs** | Tâches actives |
| **N en cours** | En cours d'exécution |
| **N échecs (24 h)** | Échecs du dernier jour |
| **N dead-letter** | Nouvelles tentatives épuisées |
| **N en retard** | Planification manquée |
| **N ne peuvent pas s'exécuter** | Tâches qui ne s'exécuteront pas telles qu'elles sont configurées |

<h2 id="legend">Légende (chronologie)</h2>

passé · en cours · prochain · futur · exécutions · échéance

## Voir aussi

- [CLI / configuration](/docs/fr/deploy/configuration/)
- [Agents](/docs/fr/agents/overview/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Fournisseurs — Effort de raisonnement](/docs/fr/ai/providers/#reasoning-effort)
- [Sauvegarde](/docs/fr/admin/backup/)
- [Accueil](/docs/fr/daily/home/)
