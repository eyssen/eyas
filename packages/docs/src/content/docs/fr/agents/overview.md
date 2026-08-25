---
title: Vue d'ensemble des agents
description: Liste, filtres, badges, niveaux et types — chaque commande de l'écran de liste.
---

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
