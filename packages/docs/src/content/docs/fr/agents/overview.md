---
title: Vue d'ensemble des agents
description: Voir chaque agent, filtrer par niveau, en ouvrir un pour le configurer.
---

**À quoi ça sert.** La liste Agents est le roster : qui existe, s’il est actif, à quel niveau il siège, et combien de budget il a consommé. Vous créez, activez et ouvrez les agents ici. Le détail (modèle, outils, voix, workspace, canaux) vit sur la page de l’agent.

## Quand l’utiliser

- Voir quels agents sont actifs, proposés ou hors budget.
- Un nouveau coéquipier — **Create Agent** — ou ouvrir un existant.
- Seulement les lignes **Primary**, **Team** ou **Specialist**.
- Vous allez lier des outils, une voix ou un canal et devez d’abord trouver le bon agent.

## Déroulement typique

1. Ouvrez **Agents** dans la barre latérale (**IA**) — route `/agents`.
2. Filtrez **All / Enabled / Primary / Team / Specialist** si la liste est longue.
3. Cliquez une ligne (ou **Create Agent**). Onglets : **Configuration**, **Memories**, **Voice**, **Workspace**, **Channels**.
4. Enregistrez. La liste doit montrer le nom, le nombre d’outils et le budget.

## Fonctions

**Chemin :** `/agents`.  
Sous-titre : *Gérez les agents d'IA, les capacités et l'attribution des outils.*

## En-tête de liste

| Commande | Signification |
|----------|---------------|
| Libellé **actifs** | Nombre / contexte des agents activés |
| **Créer un agent** | Ouvrir le flux / formulaire de création |
| Filtres **Tous / Actifs / Principal / Équipe / Spécialiste** | Restreindre la liste par statut ou niveau |

## Données d'une ligne

| Élément | Signification |
|---------|---------------|
| Nom + avatar | Identité de l'agent |
| **N outils** | Nombre d'outils liés |
| **N contraintes** | Nombre de contraintes |
| **utilisés / budget tokens** | Consommation mensuelle de tokens par rapport au budget |
| Vide / chargement / erreur | États de chargement |

## Badges

| Badge | Signification |
|-------|---------------|
| **Intégré** | Agent livré / de base |
| **Personnalisé** | Créé par l'utilisateur |
| **Proposé** | Proposé (p. ex. Forge / proposition d'équipe) |
| **En attente d'approbation** | En attente d'approbation |
| **Actif** | Activé et utilisable |
| **Désactivé** | Désactivé (non supprimé) |

## Niveaux

| Niveau | Signification |
|--------|---------------|
| **Principal** | Coéquipiers toujours actifs issus de l'installation |
| **Équipe** | Membres d'équipe de base pour la délégation |
| **Spécialiste** | Spécialistes à périmètre étroit |

## Types d'agents

| Type | Rôle typique |
|------|--------------|
| **Assistant** | Assistant personnel général |
| **Ingénieur** | Ingénieur système / plateforme |
| **Développeur** | Implémentation |
| **Réviseur** | Revue de code |
| **Critique** | Critique contradictoire |
| **Chercheur** | Recherche |
| **Planificateur** | Planification |
| **Coordinateur** | Coordination multi-agents |
| **Observateur** | Observation surtout en lecture |

## Ouvrir un agent

Cliquez une ligne → page de détail avec onglets :

| Onglet | Documentation |
|--------|---------------|
| **Configuration** | [Créer et configurer](/docs/fr/agents/configure/) |
| **Souvenirs** | Entrées de mémoire de cet agent |
| **Voix** | [Profils vocaux](/docs/fr/agents/voice/) |
| **Espace de travail** | [Identité et espace de travail](/docs/fr/agents/identity-workspace/) |
| **Canaux** | Lier des instances de messagerie |

## Voir aussi

- [Créer et configurer](/docs/fr/agents/configure/)
- [Équipes et délégation](/docs/fr/agents/teams/)
- [Exécutions et Mission Control](/docs/fr/agents/runs/)
