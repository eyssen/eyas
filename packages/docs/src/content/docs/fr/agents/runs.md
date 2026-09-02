---
title: Exécutions et Mission Control
description: Superviser les exécutions live — annuler, reprendre, réessayer — et regarder le tableau d’ops.
---

**À quoi ça sert.** **Exécutions d'agents** est la table des exécutions : live et terminées, avec statut, vérification, tours, tokens et actions. **Contrôle de mission** est le tableau de cartes live. La table pour l’historique et la reprise ; le Contrôle de mission pour le maintenant.

## Quand l’utiliser

- Une exécution est bloquée, a atteint le max de tours, ou a échoué — **Reprendre** (checkpoint) ou **Réessayer** (depuis l’objectif).
- Quelque chose tourne et vous devez annuler sans ouvrir la conversation.
- Voir si le critic a marqué **Objectif atteint** / **Objectif non atteint**.
- Totaux : en cours, en attente d’approbation, terminées aujourd’hui, coût du jour.
- Pause, interruption, ou ouverture de la conversation depuis une carte live.

## Déroulement typique

1. Ouvrez **Exécutions d'agents** dans la barre latérale (**IA**) — route `/agent-runs`. Ou **Contrôle de mission** sous **Supervision** — route `/mission-control`.
2. Sur Exécutions, **Statut** et **Vérification**. Actif : annuler ; **Échouée / Bloquée / Annulée / Tours max.** : **Reprendre** ou **Réessayer**.
3. Sur Contrôle de mission, la bande de totaux, puis sur la carte **Pause / Reprendre / Interrompre / Ouvrir la conversation**.
4. La ligne/carte doit changer de statut en live. Ouvrir la conversation montre la même exécution.

## Fonctions

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
- [Accueil — En cours d'exécution](/docs/fr/daily/home/)
- [Autonomie](/docs/fr/agents/autonomy/)

## Conformité à la marque

Quand une exécution en arrière-plan travaille dans un projet doté d'une marque et
produit quelque chose auquel une marque s'applique — une page rendue, un
brouillon d'e-mail, un document, un canevas de design —, un contrôle compare le
résultat à la marque et renvoie une fois les écarts concrets à l'agent. « Le
titre utilise #ff0000 ; la couleur primaire de la marque est #1f4ed8 » : voilà le
genre de remarque, pas « fais plus joli ».

Il ne s'exécute qu'après le contrôle de complétude. Une exécution qui n'a pas fini
son travail ne s'entend pas parler de ses couleurs.

Il est délibérément souple. Il ne fait jamais échouer une exécution qui n'a pas pu
être contrôlée — pas de modèle, pas de marque, rien qui ait la forme d'une marque
— parce que le travail est déjà fait. Là où la marque est imposée **durement**,
c'est le cadre : l'enveloppe de l'e-mail, les gabarits de notification et l'outil
HTML de marque construisent leur habillage de façon déterministe.

Il partage un seul renvoi par lignée d'exécution avec le contrôle de complétude.
Désactivation : `agent.brandCriticEnabled: false`.
