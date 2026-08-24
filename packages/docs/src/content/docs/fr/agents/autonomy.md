---
title: Autonomie
description: Jusqu'où les agents peuvent aller sans demander — indicateurs, approbations, tableau de bord.
---

**Chemins :** `/autonomy` et Paramètres → **Fonctions d'autonomie**.

L'autonomie contrôle le comportement **sans surveillance** : battements, auto-amélioration, mises à jour d'identité, et ce qui exige une **approbation humaine**.

## Principes

1. Les boucles puissantes sont **désactivées par défaut** (voir l'incitation du tableau de bord).  
2. Les approbations apparaissent sous Tableau de bord **Nécessite votre attention** et conversation **En attente d'approbation**.  
3. La configuration peut aussi restreindre l'auto-mise à jour d'identité (`autonomy.identitySelfUpdate` dans le YAML).

## Paramètres (carte Fonctions d'autonomie)

Activez / désactivez des boucles individuelles telles que (noms tels qu'affichés dans l'interface) :

| Domaine | Signification |
|---------|---------------|
| Battement / contrôles proactifs | « Y a-t-il quelque chose à faire ? » périodique |
| Réflexion / briefing | Contenu du briefing du matin |
| Propositions Forge | Changements d'identité / d'âme suggérés automatiquement |
| Auto-apprentissage / évolution des compétences | Apprendre de l'usage (toujours révisable) |
| Auto-mise à jour de l'identité | L'agent peut éditer IDENTITY directement vs uniquement via Forge |

Les libellés des interrupteurs vivent dans les locales des Paramètres (`autonomy-features-card`). Chaque interrupteur est **un indicateur de fonction uniquement** — il ne supprime pas de données.

## Surfaces du tableau de bord

| Surface | Signification |
|---------|---------------|
| Incitation à l'autonomie | Explication d'adhésion + lien vers les paramètres |
| Nécessite votre attention → Approbation | Éléments en attente d'approbation |
| Statut d'agent waiting_approval | Exécution bloquée sur vous |

## Voir aussi

- [Tableau de bord](/docs/fr/daily/dashboard/)
- [Forge](/docs/fr/agents/forge/)
- [Assistant proactif](/docs/fr/automation/proactive/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
