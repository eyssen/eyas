---
title: Assistant proactif
description: Alertes heartbeat, insights et leçons — l’assistant qui fait remonter le travail.
---

**À quoi ça sert.** L’assistant proactif surveille le travail qui a besoin de toi : conversations en retard, fils stale, anomalies, opportunités, rappels. Il ne remplace pas le Tableau ni l’Accueil. La tuile **Attention** peut montrer les mêmes alertes ; ici c’est la liste complète plus **Leçons apprises**. Laisse le heartbeat **éteint** tant que tu n’as pas compris approbation et coût.

**Route :** `/proactive`. Barre : **Proactif**.

## Quand l'utiliser

- Un coup de pouce quand le travail est overdue ou stale.
- **Heartbeat proactif** sous Autonomie et tu as besoin de la surface opérateur.
- **Vérifier maintenant** au lieu du prochain heartbeat.
- Leçons d’alertes précédentes.

## Déroulement typique

1. Active le heartbeat sous [Autonomie](/docs/fr/agents/autonomy/) seulement si tu veux du spend en arrière-plan.
2. **Proactif** (`/proactive`).
3. **Alertes actives**. Priorité **Urgent / Élevé / Normal / Faible**.
4. **Vérifier maintenant**. Vide : *Tout va bien — aucune alerte active*.
5. **Leçons apprises** (confiance %).

Signaux SLA : **Overdue**, **Stale**.

**Le texte du briefing** est écrit par le modèle d’arrière-plan d’EYAS en un appel isolé : le niveau de routage **Heartbeat** (primaire, puis fallback), puis le défaut de l’install, puis les fournisseurs API, puis les CLI capables de faire des appels isolés — jamais un fournisseur que la passerelle choisit d’elle-même, et jamais une CLI qui tourne avec ses propres outils et sa propre mémoire. Quand aucun modèle ne convient (par exemple une install Grok seul ou Kimi seul avant que leur isolation soit vérifiée) ou que le budget est à *stop*, EYAS ne fait aucun appel modèle et envoie l’alerte toute faite *Heartbeat: items may need your attention* avec la liste des raisons. Voir [Routage et budget — Le modèle d’arrière-plan](/docs/fr/ai/routing-budget/#background-model).

**Les exécutions d’arrière-plan reçoivent la même mémoire que le chat.** Quand le heartbeat ou une carte du tableau lance une exécution d’arrière-plan, celle-ci reçoit le même bloc de mémoire rappelée, avec la date et l’heure actuelles, qu’un tour de chat (voir [Mémoire — Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model)). L’objectif d’une carte est aussi mémorisé — une fois par objectif distinct, quel que soit le nombre de nouvelles tentatives — comme texte écrit par EYAS, pas par toi.

**Un seul exécuteur pour les exécutions d’arrière-plan.** Les cartes des étapes bot-listen ou auto-assignee, et les cartes `assign_task`, tournent avec la même mise en place qu’une nouvelle tentative de la même carte, qu’une [routine d’agent planifiée](/docs/fr/automation/scheduler/#agent-routines-run-in-a-conversation) et qu’un collègue lancé par une passation : supervisées, autonomes et soumises à l’échelle d’autonomie, sur le modèle de la carte, avec rappel de mémoire, designs joints, documents, capture de mémoire durable et critique de complétude. Les exécutions du tableau reçoivent désormais aussi les designs, les documents et la capture de mémoire durable, qui leur manquaient avant. Une carte d’arrière-plan prend toujours son fournisseur et son modèle d’une seule liaison, jamais le fournisseur d’une carte combiné au modèle d’un agent d’un autre fournisseur.

## Voir aussi

- [Autonomie](/docs/fr/agents/autonomy/)
- [Accueil](/docs/fr/daily/home/)
- [Conversations](/docs/fr/daily/conversations/)
- [Auto-apprentissage](/docs/fr/automation/self-learning/)
- [Planificateur](/docs/fr/automation/scheduler/)
