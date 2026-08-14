---
title: Routage et budget
description: Niveaux de routage, routage automatique, secours, plafonds de dépenses.
---

**Itinéraire :** `/providers` → onglets **Niveaux de routage** et **Budget** (également affectations de modèles dans Paramètres).

## Routage automatique

| Commande | Signification |
|----------|---------------|
| **Routage automatique Activé/Désactivé** | EYAS sélectionne le modèle optimal à partir de l'analyse du message lorsque Activé |
| Indication | *EYAS sélectionne automatiquement le modèle optimal d'après l'analyse du message* |

## Niveaux de routage

Chaque niveau a un fournisseur+modèle **Principal** et un **Secours** facultatif :

| Niveau | Usage typique |
|--------|---------------|
| **Triage** | Classification / routage léger |
| **Rapide** | Réponses rapides et économiques |
| **Standard** | Qualité par défaut |
| **Complexe** | Tâches difficiles |
| **Exécution de code** | Travail fortement lié au code |
| **Battement** | Boucles proactives / heartbeat |
| **Embedding** | Embeddings vectoriels |
| **Améliorateur de prompts** | Agent d'amélioration des prompts |

| Champ | Signification |
|-------|---------------|
| **Sélectionnez un fournisseur…** | Fournisseur principal du niveau |
| **Sélectionnez un modèle…** | Modèle principal |
| **Secours / Aucun** | Secours si le principal échoue |

### Bascule automatique inter-fournisseurs (opt-in)

Lorsque le **basculement automatique** est activé (`EYAS_AUTO_FAILOVER=1` ou configuration équivalente), les emplacements **Secours** vides d'un niveau peuvent être remplis depuis un second fournisseur en ligne. **Les secours déjà définis ne sont jamais écrasés.**

Utilisez ceci pour la résilience lorsqu'un cloud/CLI principal est instable ; préférez tout de même des secours explicites que vous choisissez pour maîtriser le coût et la qualité.

## Budget / plafonds de dépenses

| Champ | Signification |
|-------|---------------|
| **Quotidien / Hebdomadaire / Mensuel** | Plafonds pour la période (`unlimited` si politique vide/0) |
| **Avertir à** | Seuil d'avertissement (% ou valeur absolue selon l'interface) |
| **Rétrograder à** | Passer à des modèles moins chers |
| **Arrêt définitif à** | Bloquer toute dépense supplémentaire |

Les budgets mensuels de jetons au niveau de l'agent sont distincts (Configuration de l'agent).

## Voir aussi

- [Fournisseurs](/docs/fr/ai/providers/)
- [Agents — budget de jetons](/docs/fr/agents/configure/)
