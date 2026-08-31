---
title: Équipes et délégation
description: Planifier le travail multi-agents — phases, transferts, et la proposition que vous approuvez dans le chat.
---

**À quoi ça sert.** Les équipes sont la façon dont un agent primaire délègue. Vous configurez les phases ici ; dans une conversation l’agent peut proposer un plan que vous **Approve** ou **Skip**. Les sous-conversations et le Team Dashboard montrent qui fait quoi. C’est de la collaboration, pas God Mode (plusieurs modèles sur la même tâche).

## Quand l’utiliser

- Le travail a besoin de spécialistes en parallèle ou en séquence, pas d’un agent seul.
- Des worktrees git pour que les éditeurs parallèles ne se marchent pas dessus.
- Des modèles de spécialistes manquants depuis la carte (**Create now**).
- Une mémoire d’équipe partagée : findings, decisions, blockers.

## Déroulement typique

1. Ouvrez **Agents** et confirmez que le primaire et les spécialistes existent (assistant **Team agents**, ou créez-les ici).
2. Démarrez une conversation, mettez **Orchestration** sur **Auto** ou **Deep**, envoyez un objectif complexe.
3. Si **Team proposal** apparaît, relisez les phases (parallel / sequential), puis **Approve** (ou **Create now**).
4. **Team / Sub-conversations → Open Team Dashboard**. Vous devez voir les chats membres, la phase et les entrées de mémoire d’équipe.

## Fonctions

Les agents collaborent par **délégation**, **sessions d'équipe** dans les conversations, et une interface facultative de **configuration d'équipe**.

## Concepts

| Concept | Signification |
|---------|---------------|
| **Principal** | Orchestre le travail quotidien ; peut déléguer |
| **Équipe / spécialiste** | Reçoit les tâches déléguées dans son domaine |
| **Transfert** | Passage du travail (souvent avec des artefacts) à un autre agent |
| **Session d'équipe** | Exécution multi-agents visible comme sous-conversations |
| **Proposition d'équipe** | Plan que l'utilisateur doit approuver avant le déploiement |

## Constructeur d'équipe (interface agent)

| Commande | Signification |
|----------|---------------|
| **Constructeur d'équipe** | Configurer des plans d'équipe multi-phases |
| **N phases** | Nombre de phases d'orchestration |
| **Est. ~N tokens** | Estimation approximative de tokens pour le plan |

Modes de phase (aussi sur les propositions d'équipe dans le chat) :

| Mode | Signification |
|------|---------------|
| **parallèle** | Les agents de la phase s'exécutent simultanément |
| **séquentiel** | Étapes ordonnées |

### Worktrees et vérification

| Comportement | Quand |
|--------------|-------|
| **Git worktrees** | Les propositions d'équipe pour des objectifs **complexes** et **épiques** isolent les agents sous `.eyas-worktrees/` (évite les conflits de fichiers lors d'éditions parallèles) |
| **Commandes de vérification** | Les `agent.verifyCommands` facultatifs dans le YAML lancent lint/test après une exécution, avant le critique de complétude — voir [Configuration](/docs/fr/deploy/configuration/) |

## Dans les conversations

Voir [Conversations — Fonctions d'équipe](/docs/fr/daily/conversations/) :

- Arbre de sous-conversations  
- Tableau de bord d'équipe (constats, décisions, blocages)  
- Proposition d'équipe **Approuver / Ignorer / Créer les spécialistes manquants**  

## Chemin d'installation

L'étape facultative **Agents d'équipe** de l'[assistant d'installation](/docs/fr/setup-wizard/) sélectionne des modèles de spécialistes. Modifiez plus tard sous Agents / Paramètres.

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Exécutions et Mission Control](/docs/fr/agents/runs/)
- [Vue d'ensemble des agents](/docs/fr/agents/overview/)
