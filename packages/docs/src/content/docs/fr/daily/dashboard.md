---
title: Accueil
description: Écran d’accueil — attention, travail en cours, recommandations de configuration, briefing, planning.
---

**Route :** `/` (nav : **Accueil**).  
Sous-titre : *Ce qui vous attend — et ce qui tourne actuellement.*

## Sections

### Bandeau de statistiques

| Libellé | Signification |
|---------|---------------|
| **Vous attend** | Éléments qui nécessitent un humain (approbations, exécutions bloquées, retards, …) |
| **En cours** | Agents / exécutions actuellement actifs |
| **En attente** | Bloqués en attente d’une réponse ou d’une approbation |
| **Coût aujourd’hui** | Dépense estimée des modèles pour la journée (lorsque le suivi des coûts est disponible) |

### Incitation à l’autonomie

| Commande | Signification |
|----------|---------------|
| Titre / corps | Explique les boucles d’auto-amélioration à activer (désactivées par défaut) |
| **Examiner les paramètres d’autonomie** | Ouvre les paramètres d’autonomie |
| **Ignorer** | Masquer cette incitation |

### Configuration recommandée

Liste de contrôle de l’intégration restante. Les éléments terminés disparaissent ; les facultatifs peuvent attendre.

| Commande | Signification |
|----------|---------------|
| **Configurer** | Aller à l’écran de paramètres correspondant |
| **Masquer cette recommandation** | Ignorer un élément |
| **Masquer toutes les recommandations** | Ignorer toute la carte |
| Badge **Facultatif** | Non requis pour un usage de base |
| Texte de progression | Combien restent / sont faits / sont masqués |

#### Éléments de recommandation

| Élément | Quoi configurer |
|---------|-----------------|
| **Modèles d’IA et fournisseurs** | Au moins un fournisseur + des modèles activés |
| **Projets** | Projet pour le travail / la maison / les clients |
| **Prompts de base et personnalité** | Prompt maître / personas |
| **Agents et équipe** | Activer / personnaliser les assistants |
| **Communication de l’agent principal** | Lier un canal (Telegram, …) à l’agent principal |
| **Répertoires à indexer** | Sources de recherche pour le code / les documents |
| **Coffre de mémoire** | Amorcer des notes du coffre |
| **Sauvegardes** | Première sauvegarde (puis planification) |
| **Accès distant (Ingress)** | Tunnel facultatif |
| **Autonomie et auto-amélioration** | Boucles d’arrière-plan facultatives |

### Nécessite votre attention

| Type | Signification |
|------|---------------|
| **Approbation** | Approbation de sécurité / autonomie en attente |
| **Reprise bloquée** | L’exécution doit être reprise |
| **Agent en attente** | Agent bloqué en attente d’entrée |
| **En retard** | Travail dont l’échéance est dépassée |
| **Échéance aujourd’hui** | À rendre aujourd’hui |
| **Alerte** | Alerte proactive |

État vide : *Rien n’attend votre intervention pour le moment.*

### Épinglés

Conversations épinglées depuis le Tableau. **Désépingler** retire l’épingle (ne supprime pas la conversation).

### Récentes

Dernières conversations (titre ou *Conversation sans titre*). **Ouvrir** mène au fil.

### En cours d’exécution

Activité d’agents en direct (données Mission Control). Statuts : En cours, En attente d’approbation, En pause, Inactif, Au travail, Erreur, …

### Briefing du matin

Rempli lorsque les réflexions de mémoire / la génération de briefing sont activées. Vide jusque-là.

### À venir

Prochaines tâches du planificateur. Affiche des horaires relatifs (*dans 5 min*, *il y a 2 h*, …).

## Voir aussi

- [Conversations](/docs/fr/daily/conversations/)
- [Tableau](/docs/fr/daily/board/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Assistant de configuration](/docs/fr/setup-wizard/)
