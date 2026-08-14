---
title: Exécutions et Mission Control
description: Liste des exécutions d'agents, progression, cartes et actions de Mission Control.
---

## Exécutions d'agents

**Chemin :** `/agent-runs`. Exécutions historiques et en direct des agents (tours, tokens, statut).

Colonnes / états typiques (interface produit) :

| Élément | Signification |
|---------|---------------|
| Id / heure d'exécution | Moment de démarrage de l'exécution |
| Agent | Quel agent s'est exécuté |
| Statut | en cours / terminée / échouée / annulée / waiting_approval / en pause |
| Tokens / coût | Consommation de l'exécution |
| Lien vers la conversation | Ouvrir le fil parent |

## Mission Control

**Chemin :** `/mission-control`. Tableau opérationnel des agents **en direct**.

| Élément | Signification |
|---------|---------------|
| Carte d'agent | État en direct d'un agent |
| Statut | En cours, En attente d'approbation, En pause, Inactif, Erreur, … |
| Actions | Arrêter / reprendre / ouvrir la conversation (selon les actions proposées par la carte) |

Utilisez Mission Control lorsque vous avez besoin d'une vue d'exploitation d'un coup d'œil ; utilisez Exécutions d'agents pour l'historique.

## Dans une conversation

Pendant qu'une exécution est active, vous voyez aussi :

- Progression de l'agent (tour N/max, tokens, Annuler)  
- Arbre d'exécution / flux de travail  
- Dérouleurs d'appels d'outils  

Documenté sous [Conversations](/docs/fr/daily/conversations/).

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Tableau de bord — En cours d'exécution](/docs/fr/daily/dashboard/)
- [Autonomie](/docs/fr/agents/autonomy/)
