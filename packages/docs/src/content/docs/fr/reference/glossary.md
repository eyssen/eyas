---
title: Glossaire
description: Termes du produit.
---

| Terme | Définition |
|-------|------------|
| Agent | Acteur d'IA configuré |
| Primary | Coéquipiers d'installation toujours actifs |
| Compétence | Paquet de procédures Markdown |
| Outil | Capacité invocable |
| Surface de codage | Outils de fichiers indépendants du modèle (`read_file`, `edit_file`, `grep`, …) appartenant à EYAS, pas à un SDK fournisseur unique |
| Worktree | Arbre de travail git isolé pour un agent d'équipe parallèle (`.eyas-worktrees/`) |
| Commandes de vérification | Programmes lint/test configurés, exécutés après un run d'agent avant le critique LLM |
| Crochet d'outil | Rappel PreToolUse / PostToolUse à chaque exécution d'outil |
| Tableau | Surface de suivi du travail |
| Conversation | Fil de discussion |
| Niveau de mémoire | working→episodic→vault→archive |
| Bloc de mémoire | Note partagée à portée définie (entreprise/agent/équipe/run) que les agents lisent/écrivent via des outils |
| Coffre | Connaissance Markdown à long terme |
| Fournisseur | Backend LLM |
| MCP | Model Context Protocol |
| Connexion | Entrée nommée de l'inventaire d'un système externe (Odoo, GitHub, MCP, …) avec santé + secrets du coffre |
| Canal | Connecteur de messagerie externe |
| Ancrage | Exiger une preuve de recherche / récupération avant d'affirmer des faits issus de sources indexées |
| Recherche hybride | Fusion FTS + récupération vectorielle (RRF) |
| Source de recherche | Arbre indexé nommé (chemins + libellé/version/édition/famille facultatifs) sous Sources de recherche |
| Épinglage de source de code | Sélection, dans une conversation ou un projet, des sources de recherche que les agents peuvent interroger |
| needsPin | Réponse d'outil lorsque plusieurs versions de la famille odoo sont prêtes mais qu'aucune n'est épinglée |
| Prompt Enhancer | Coach itératif des brouillons d'invites de conversation (conscient de la famille de modèles) |
| Prompt Coach | Coach itératif des invites système durables de projet / agent |
| Forge | Modifications d'âme / d'identité approuvées |
| Portail de sécurité | Politique préalable à l'action |
| CASL | Bibliothèque d'autorisation |
| Orchestration | Politique de sous-agents Solo/Auto/Deep |
| Effort | Réglage de la profondeur de raisonnement |
| Violation de SLA | Signal proactif pour un travail en retard ou périmé |
| A2A | Protocole agent-à-agent (carte + exécution de tâches) |
