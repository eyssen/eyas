---
title: Auto-apprentissage et évolution des compétences
description: Insights d’usage, suggestions de compétences et candidats revus par un humain.
---

**À quoi ça sert.** Deux surfaces. **Insights d’auto-apprentissage** (`/self-learning`) rapporte tokens, coût et motifs. **Évolution des compétences** (`/skill-evolution`) est la porte humaine pour de nouvelles compétences suggérées. Rien n’écrit le comportement avant approbation.

**Routes :** `/self-learning` (barre **Auto-apprentissage**), `/skill-evolution`.

## Quand l'utiliser

- Photo hebdomadaire d’efficacité.
- Travail répété qui devrait devenir une compétence — suggestion, pas d’auto-écriture.
- Candidats en attente : **Approuver** / **Rejeter**.
- Le versant compétence à côté de [Forge](/docs/fr/agents/forge/).

## Déroulement typique

1. **Auto-apprentissage** : quatre cartes, insights, motifs, suggestions.
2. **Lancer l’analyse**.
3. **Évolution des compétences** : Pending / Approved / Rejected.
4. Détails, raisonnement, contenu — **Approuver** (passe encore le portail d’auto-adoption) ou **Rejeter**.
5. Vérifie [Compétences](/docs/fr/automation/skills/) → **Inventaire**.

**Quel modèle les écrit.** Les suggestions d’auto-apprentissage, les propositions de description Forge et l’écriture de compétences pour l’Évolution des compétences tournent sur le modèle d’arrière-plan d’EYAS, un appel isolé chacun : le niveau de routage **Heartbeat** (primaire, puis fallback), puis le défaut de l’install, puis les fournisseurs API, puis les CLI capables de faire des appels isolés. Ils ne vont jamais à un fournisseur que la passerelle choisit d’elle-même. Quand aucun modèle ne convient (par exemple une install Grok seul ou Kimi seul avant que leur isolation soit vérifiée) ou que le budget est à *stop*, aucun appel modèle n’a lieu : l’Auto-apprentissage montre ses phrases de suggestion génériques, Forge garde la proposition de description concaténée, et l’Évolution des compétences écrit le `SKILL.md` modèle. Les indicateurs de fonction d’Autonomie filtrent toujours ces appels. Voir [Routage et budget — Le modèle d’arrière-plan](/docs/fr/ai/routing-budget/#background-model).

## Voir aussi

- [Compétences](/docs/fr/automation/skills/)
- [Forge](/docs/fr/agents/forge/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Proactif](/docs/fr/automation/proactive/)
