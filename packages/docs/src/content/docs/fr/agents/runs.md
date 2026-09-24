---
title: Exécutions et Mission Control
description: Superviser les exécutions d’agents en direct — annuler, reprendre, réessayer — et suivre le tableau des opérations.
---

**À quoi ça sert.** **Exécutions d'agents** est le tableau des exécutions : en cours et terminées, avec statut, vérification, tours, tokens et actions. **Mission Control** (dans la barre latérale, **Contrôle de mission**) est le tableau d’opérations en direct des cartes d’agents — qui tourne, qui vous attend, qui a fini. Utilisez le tableau pour l’historique et la reprise ; utilisez Mission Control pour un coup d’œil sur l’instant.

## Quand l’utiliser

- Une exécution est bloquée, a atteint le maximum de tours ou a échoué — vous voulez **Reprendre** (point de contrôle) ou **Réessayer** (depuis l’objectif).
- Quelque chose tourne et vous devez **Annuler** sans ouvrir la conversation.
- Vous voulez voir si le critique d’exhaustivité a indiqué **Objectif atteint** / **Objectif non atteint**.
- Il vous faut des totaux : en cours, en attente d’approbation, terminés aujourd’hui, coût du jour.
- Vous voulez interrompre une exécution ou ouvrir sa conversation depuis une carte en direct.

## Déroulement typique

1. Ouvrez **Exécutions d'agents** dans la barre latérale (section **IA**) — route `/agent-runs`. Ou **Contrôle de mission** sous **Supervision** — route `/mission-control`.
2. Dans Exécutions d'agents, parcourez **Statut** et **Vérification**. Pour une ligne active, **Annuler** ; pour une ligne échouée, bloquée, annulée ou arrêtée au maximum de tours, **Reprendre** ou **Réessayer**.
3. Dans Mission Control, lisez la bande des totaux, puis agissez sur une carte (**Interrompre**, **Ouvrir la conversation**).
4. La ligne ou la carte change de statut en direct (WebSocket). Ouvrir la conversation montre la progression, l’arbre d’exécution et les appels d’outils de la même exécution.

## Exécutions d’agents

**Route :** `/agent-runs`. Sous-titre : *Supervision en direct des exécutions d'agents — les exécutions bloquées sont détectées et peuvent être annulées.* Vide : *Aucune exécution d'agent pour le moment.*

| Colonne | Signification |
|---------|---------------|
| **Statut** | Voir les statuts ci-dessous |
| **Vérification** | Critique d’exhaustivité : **Objectif atteint** / **Objectif non atteint** / **Non vérifié** (ou — si jamais vérifié) |
| **Agent** | Identifiant de l’agent |
| **Type** | Type d’exécution (ou —) |
| **Tours** | Tours utilisés |
| **Tokens** | Tokens utilisés |
| **Dernière progression** | Temps écoulé depuis le dernier signe de vie |
| **Actions** | **Annuler** (en cours, bloquée, actualisation) · **Reprendre** · **Réessayer** (échouée, bloquée, annulée, tours max.) |

### Statuts

| Statut | Signification |
|--------|---------------|
| **En cours** | En progression |
| **Bloquée** | Aucune progression — annulable / relançable |
| **Actualisation** | Reprise à chaud en cours |
| **En attente d'approbation** | En attente d’une approbation d’autonomie |
| **Terminée** | Finie |
| **Tours max.** | Budget de tours atteint sans terminer — reprendre ou réessayer |
| **Échouée** | Erreur |
| **Annulée** | Arrêtée |

### Vérification

| Badge | Signification |
|-------|---------------|
| **Objectif atteint** | Un modèle réviseur a comparé le résultat à l’objectif et l’a jugé atteint |
| **Objectif non atteint** | L’objectif n’a pas été atteint ; les écarts ont été renvoyés une fois à l’agent |
| **Non vérifié** | Impossible à vérifier (pas de modèle réviseur, ou rien d’enregistré) |

**Non vérifié** apparaît aussi quand aucun modèle d’arrière-plan n’a pu faire la vérification (par exemple une installation uniquement Grok dont l’isolation n’est pas encore vérifiée), quand le budget modèle est arrêté, ou quand toutes les tentatives ont échoué ; l’exécution elle-même se termine normalement.

**Les preuves que le critique accepte.** Quand l’objectif d’une exécution demande des sources (rechercher, consulter, citer, implémenter, corriger, refactoriser…), le critique cherche des éléments d’appui, et juge chaque modèle de la même façon :

- **La mémoire qu’EYAS a fournie à l’exécution compte comme preuve**, quel que soit le fournisseur ou le modèle qui l’a exécutée. Le modèle réviseur apprend quels éléments de mémoire ont été fournis et juge si la réponse est fondée.
- **Les preuves d’outils viennent du journal d’exécution des outils d’EYAS**, pas seulement des noms que rapporte le fournisseur : un `memory_search` passé par le pont de Claude Code ou de Grok/Kimi compte comme un appel natif.
- `memory_expand` compte aussi comme preuve de recherche.

Une exécution sans mémoire fournie, sans appel d’outil de recherche et sans citation `[source:…]` est marquée **Objectif non atteint** quand son objectif demande des sources. Le critique d’exhaustivité, et la grille rédigée pour les objectifs complexes en arrière-plan, tournent en un seul appel court et isolé sur le modèle d’arrière-plan d’EYAS — sans outils, sans historique de conversation (voir [Routage et budget — Le modèle d’arrière-plan](/docs/fr/ai/routing-budget/#background-model)). Sans un tel modèle, aucune grille n’est rédigée.

### Reprendre et Réessayer avec chaque fournisseur

**Reprendre** continue depuis le dernier point de contrôle (garde anti-répétition). **Réessayer** replanifie depuis l’objectif ; les appels destructeurs déjà exécutés restent protégés. Les deux fonctionnent de la même façon pour les exécutions sur Claude Code, Grok CLI et Kimi CLI que pour les fournisseurs d’API :

- EYAS enregistre les outils qu’une CLI a exécutés d’elle-même (commandes shell, écritures et modifications de fichiers, outils EYAS appelés) dans l’historique de l’exécution et dans son journal d’exécution des outils, sous les noms qu’utilise EYAS (Bash apparaît comme `run_command`, etc.).
- Après un tour où la CLI a exécuté des outils, et chaque fois qu’une exécution s’arrête pour attendre une approbation, EYAS enregistre un point de contrôle : la conversation jusque-là plus la réponse du modèle.
- Reprendre ou Réessayer continue depuis ce point de contrôle, et le modèle reçoit un récapitulatif des outils déjà exécutés.
- Si le modèle tente de répéter un appel destructeur que l’exécution d’origine a déjà réussi, EYAS le refuse avant que la CLI ne l’exécute : *already executed on the original run — duplicate side effect prevented*. Le même appel avec d’autres arguments, ou un appel qui a échoué la première fois, est autorisé. Les modifications et déplacements de fichiers faits par une CLI sont couverts aussi.
- La même garde couvre les outils EYAS que Grok et Kimi appellent via le pont d’outils : une exécution reprise ou relancée qui répète un appel d’outil EYAS que l’exécution d’origine a déjà terminé (par exemple l’envoi du même e-mail ou de la même facture) est refusée avant de s’exécuter, et la ligne d’outil affiche **Ignoré** avec cette raison. Le même outil avec d’autres arguments s’exécute toujours. Prouvé sur le Grok CLI installé ; la façon dont un vrai binaire Kimi rapporte ces appels n’a pas encore été vérifiée sur un hôte.
- Dans une exécution en arrière-plan sur Grok ou Kimi, un appel d’outil EYAS dans une catégorie en **Avis** ou **Approuver**, ou que la porte de sécurité remonte (même en **Auto**), attend une approbation ; l’exécution supervisée se met en pause comme **En attente d'approbation** une fois le tour de la CLI terminé, et l’approbation laisse exactement cet appel s’exécuter une fois. Voir [Autonomie](/docs/fr/agents/autonomy/).

### Comment une exécution se termine

- Une exécution qui atteint sa limite de tours se termine normalement avec le statut **Tours max.**, et la réponse partielle est conservée.
- Une exécution qui épuise son budget d’appels d’outils se termine aussi normalement ; son statut reste **Terminée**.
- Un arrêt propre au modèle (limite de tours, longueur ou refus) est un résultat, pas une erreur.
- Un appel d’outil qui n’a jamais tourné n’est pas présenté comme un succès. La raison est l’une de celles-ci : ignoré par la limite par tour, ignoré par le budget d’outils de l’exécution, ignoré comme doublon à la reprise, refusé par la porte de sécurité, ou en attente d’approbation. Le chat affiche chacune comme un statut propre sur la ligne d’outil, un badge sous la réponse indique comment le tour s’est terminé, et un appel en attente d’approbation ouvre une carte d’approbation dans la conversation ainsi qu’une entrée dans la file des [Approbations](/docs/fr/agents/autonomy/) — voir [Conversations — Issue du tour](/docs/fr/daily/conversations/#turn-outcome).
- Quand une exécution se termine avec une réponse, la capture de mémoire durable s’exécute dessus — pour les exécutions en arrière-plan, de spécialiste, déléguées, de pipeline, A2A et de membre d’équipe comme pour les tours de chat, sous les mêmes réglages `memory.capture.*`. Une exécution qui n’a rien répondu n’écrit aucune ligne de capture, et le registre de capture note de quel chemin vient une ligne (`entry_path`). Voir [Mémoire — Le capture est activé par défaut](/docs/fr/knowledge/memory/#capture-is-on-by-default).

## Mission Control

**Route :** `/mission-control`. Sous-titre : *Vue en direct de tous les agents en cours d'exécution.* Vide : *Aucun agent n'est en cours d'exécution.* Bandeau **Déconnecté — reconnexion…** quand le socket est coupé.

### Totaux

| Mesure | Signification |
|--------|---------------|
| **En cours** | En direct maintenant |
| **En attente d'approbation** | Vous attend |
| **Terminés aujourd'hui** | Débit du jour |
| **Coût du jour** | Dépense du jour |

Les cartes sont triées en commençant par celles en attente d’approbation, puis en cours, en pause, inactives, échouées, terminées, annulées ; au sein d’un statut, la plus récemment mise à jour en premier.

| Élément de carte | Signification |
|------------------|---------------|
| Statut | **Inactif · En cours · En attente d'approbation · En pause · Terminé · Échoué · Annulé** |
| **Tour / Tokens / Coût** | Consommation |
| ↳ *parent* | L’exécution a été lancée par une autre exécution |
| *N approbation(s) en attente* | File de cette session |
| **Interrompre** | Arrête l’exécution après confirmation (*Interrompre cet agent ?*). Seulement pendant qu’elle tourne, et seulement pour l’utilisateur qui l’a lancée ou un owner ou admin |
| **Ouvrir la conversation** | Aller au fil |

La carte n’a pas de commande de pause ni de reprise. Pour continuer une exécution arrêtée, utilisez **Reprendre** ou **Réessayer** dans Exécutions d'agents.

## Dans une conversation

Pendant qu’une exécution est active, vous voyez aussi :

- La progression de l’agent (*Étape N / Max* quand le fournisseur rapporte des étapes, sinon *Appels d'outils : N* ; tokens cumulés de l’exécution ; Annuler)
- L’arbre d’exécution / le workflow — avec chaque fournisseur, avec statut et coût de l’exécution
- Les appels d’outils dépliables, les badges d’issue du tour et les cartes d’approbation

Documenté dans [Conversations](/docs/fr/daily/conversations/).

Une exécution travaille dans les dossiers de travail de sa conversation. Une conversation sans dossiers propres a son propre espace de travail EYAS, qu’elle reçoit à sa création ou, pour les conversations plus anciennes, au message suivant — une exécution ne choisit jamais un dossier d’elle-même. Voir [Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders).

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Accueil — En cours](/docs/fr/daily/home/)
- [Autonomie](/docs/fr/agents/autonomy/)
