---
title: Autonomie
description: Jusqu’où les agents peuvent aller sans demander — file d’approbations et trois niveaux.
---

**À quoi ça sert.** L’autonomie est le cadran de sécurité. Par classe d’action vous choisissez **Avis** (demander d’abord), **Approuver** (proposition + un clic) ou **Auto** (faire et rendre compte après). Les actions sortantes et irréversibles restent verrouillées sur Avis. La même page est la file **Approbations en attente** qui parque une exécution jusqu’à votre décision.

## Quand l’utiliser

- Une conversation est **En attente d'approbation** et vous devez **Approuver** ou **Rejeter** sans deviner ce qui est parqué.
- Le travail réversible (edits de fichiers, recherche) en **Auto**, mais jamais relever une classe sortante verrouillée.
- Une reprise a échoué après que vous avez déjà approuvé — la ligne coincée vous attend encore.
- Allumer ou éteindre heartbeats, propositions Forge ou identity self-update comme flags.

## Déroulement typique

1. Ouvrez **Autonomie** dans la barre latérale (**Supervision**) — route `/autonomy`. Les flags vivent sous **Paramètres → Système** (carte Fonctions d'autonomie).
2. Lisez **Approbations en attente**. Pour chaque ligne, **Approuver** ou **Rejeter**. **Exécution en attente** mène à la conversation.
3. Sous **Réversible**, mettez une catégorie sur **Avis / Approuver / Auto** (les verrouillées ne dépassent pas Avis).
4. L’exécution parquée doit reprendre (ou rester arrêtée si rejet). Accueil **Nécessite votre attention** et le badge de conversation doivent disparaître.

## Fonctions

L'autonomie contrôle le comportement **sans surveillance** : battements, auto-amélioration, mises à jour d'identité, et ce qui exige une **approbation humaine**.

Niveaux : **Avis** · **Approuver** · **Auto**. Groupes : **Réversible** et **Sortant / irréversible (verrouillé)**. Vide : *Rien n'attend d'approbation.*

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

- [Accueil](/docs/fr/daily/home/)
- [Forge](/docs/fr/agents/forge/)
- [Assistant proactif](/docs/fr/automation/proactive/)
- [Sécurité et confidentialité](/docs/fr/admin/security-privacy/)
