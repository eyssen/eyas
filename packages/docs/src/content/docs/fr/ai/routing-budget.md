---
title: Routage et budget
description: Niveaux d’auto-routage, fallbacks, plafonds de dépense et affectations de modèles.
---

**À quoi ça sert.** Le routage choisit *quel* modèle répond. Le budget limite *combien* tu dépenses (avertir, rétrograder, hard-stop). Les affectations épinglent le modèle par défaut de chaque agent graine après le setup.

**Route :** `/providers` → **Niveaux de routage** et **Budget**. Affectations : Paramètres → **Affectations de modèles**.

## Quand l'utiliser

- Pas cher pour le triage, plus fort pour le code.
- Le primaire vacille — **Fallback** explicite ou auto-failover (`EYAS_AUTO_FAILOVER=1`, ne écrase jamais les fallbacks déjà posés).
- Plafonds jour/semaine/mois.
- Agents graine sans modèle après l’assistant.

## Déroulement typique

1. **Fournisseurs** → **Niveaux de routage**.
2. **Auto-routage On**.
3. Par niveau **Primaire** + **Fallback** optionnel.
4. **Budget** : Daily/Weekly/Monthly, Warn / Downgrade / Hard stop.
5. **Paramètres** → **Affectations de modèles** → **Enregistrer les affectations**.

Niveaux : Triage, Quick, Standard, Complex, Code Execution, Heartbeat, Embedding, Prompt Enhancer.

## Voir aussi

- [Fournisseurs](/docs/fr/ai/providers/)
- [Agents — budget](/docs/fr/agents/configure/)
- [Prompts](/docs/fr/ai/prompts/)
- [Proactif](/docs/fr/automation/proactive/)
