---
title: Équipes et délégation
description: Constructeur d'équipe, phases, transferts et collaboration multi-agents.
---

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
