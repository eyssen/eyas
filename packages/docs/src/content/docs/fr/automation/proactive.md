---
title: Assistant proactif
description: Suggestions, alertes et signaux SLA pilotés par le heartbeat.
---

**Route :** `/proactive` (et alertes du tableau de bord).

Lorsqu’il est activé sous [Autonomie](/docs/fr/agents/autonomy/), EYAS évalue périodiquement s’il doit vous notifier ou agir (dans les limites de la politique). Les alertes apparaissent comme des éléments **Nécessite votre attention → Alerte** du tableau de bord.

Laissez les boucles **désactivées** jusqu’à ce que vous compreniez les paramètres d’approbation et de sécurité.

---

## Battement et SLA

Le heartbeat proactif peut émettre des signaux de **violation de SLA** (`slaBreaches`) lorsque le travail dérive :

| Type de signal | Signification typique |
|----------------|-----------------------|
| **En retard** | Conversation / activité au-delà de l’échéance |
| **Obsolète** | Conversation inactive trop longtemps alors qu’elle est encore ouverte / en cours |

Traitez-les comme des surfaces d’attention pour l’opérateur — combinez-les avec la priorité du Tableau et les recommandations de configuration du [Accueil](/docs/fr/daily/home/).

---

## Voir aussi

- [Autonomie](/docs/fr/agents/autonomy/)
- [Accueil](/docs/fr/daily/home/)
- [Conversations](/docs/fr/daily/conversations/)
