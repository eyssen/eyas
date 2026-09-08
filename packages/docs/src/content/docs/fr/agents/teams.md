---
title: Équipes et délégation
description: Collègues à qui tu parles, spécialistes qu'ils lancent, et quand une proposition d'équipe apparaît encore.
---

**À quoi ça sert.** Tu parles à des **collègues** (agents primary et team). Ils ont des rôles stricts. Ils passent le travail à un autre collègue ou lancent des **spécialistes** d'un pool partagé — automatiquement, souvent en parallèle. Une carte de proposition d'équipe n'apparaît que si un spécialiste manque, tu as demandé une équipe, ou le travail est épique.

C'est de la collaboration, pas le God Mode.

## Quand l'utiliser

- Tu veux parler à l'Assistant ou à l'Ingénieur système comme à des personnes.
- Un travail a besoin de plusieurs spécialistes à la fois (`run_specialist` dans un tour).
- Git worktrees pour que les éditeurs parallèles ne se marchent pas dessus.
- Tu veux un plan visible à **Approve** si le spécialiste n'existe pas encore.

## Déroulement

1. Ouvre un **collègue** dans la barre latérale.
2. Confie-lui le travail. `handoff_to_colleague` ou `run_specialist`.
3. Les exécutions de spécialistes apparaissent en sous-conversations. La mémoire d'équipe marche sans carte (session implicite).
4. Plusieurs spécialistes : **Team Dashboard**.
5. **Team proposal** pour `/team` ou un travail épique — **Approve** ou **Skip**.

## Concepts

| Concept | Sens |
|---------|------|
| **Collègue** | Agent primary ou team avec un fil d'accueil. |
| **Spécialiste** | Travailleur étroit. Pool partagé. |
| **`run_specialist`** | Spawn en ligne. Vert. Alias : `delegate_to_agent`. |
| **`handoff_to_colleague`** | Fil d'accueil de l'autre collègue. Vert. |
| **`assign_task`** | Carte de tableau asynchrone. Vert si la cible est active. |
| **`propose_team`** | Carte pour rôles manquants / épique / demande explicite. Jaune. |

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Exécutions](/docs/fr/agents/runs/)
- [Aperçu des agents](/docs/fr/agents/overview/)
