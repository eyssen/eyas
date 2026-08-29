---
title: Glossaire
description: Termes produit.
---

| Terme | Définition |
|-------|------------|
| Agent | Acteur IA configuré |
| Primary | Coéquipiers de setup toujours on |
| Skill | Paquet de procédure markdown |
| Proposition de compétence | Skill qui matche et que le tour attend — **L'utiliser**, **Pas cette fois**, ou owner/admin **Désactiver** |
| Outil | Capacité invocable |
| Coding surface | Outils fichier agnostiques au modèle (`read_file`, `edit_file`, `grep`, …) d’EYAS |
| Worktree | Arbre git isolé pour un agent d’équipe parallèle (`.eyas-worktrees/`) |
| Verify commands | Lint/test après une exécution, avant le critique LLM |
| Tool hook | PreToolUse / PostToolUse à chaque exécution |
| Tableau | Surface de suivi du travail |
| Conversation | Fil de chat |
| Niveau mémoire | Working→episodic→vault→archive |
| Memory block | Note partagée scopée (company/agent/team/run) |
| Vault | Connaissance markdown long terme |
| Capture run | Une extraction de mémoire durable post-tour ; chaque résultat écrit `memory_capture_runs`. Interrupteur : `memory.capture.enabled` |
| Canevas de design | Multi-artboard `.dc.html` + `canvas.json`, format Claude Design avec runtime EYAS |
| Fournisseur | Backend LLM |
| MCP | Model Context Protocol |
| Connection | Entrée d’inventaire d’un système externe (Odoo, GitHub, MCP, …) |
| Canal | Connecteur de messagerie externe — pas Connection, pas Main |
| Main (Hand) | Client local apparié avec outils OS/CLI/bureau ([Mains](/docs/fr/admin/hands/)) |
| Studio | Moteurs de production locaux (HTML ou rushes → fichier). Pas Media. ([Studio](/docs/fr/studio/)) |
| Video Use | Moteur Studio qui coupe des rushes depuis un EDL ([Video Use](/docs/fr/studio/videouse/)) |
| Browser Use | Sidecar CLI optionnel pour un Chrome connecté via CDP ([Browser Use](/docs/fr/automation/browser-use/)) |
| Nœud distant | Autre machine que cette instance atteint (SSH et amis) ([Nœuds](/docs/fr/admin/nodes/)) |
| Pack d’extension | Pack de skills tiers du catalogue, check MIT ([Extensions](/docs/fr/admin/extensions/)) |
| Recordly | Enregistreur d’écran bureau AGPL ; compagnon tiers via Extensions, non livré, pas un moteur Studio ([Recordly](/docs/fr/admin/extensions/#recordly)) |
| Grounding | Exiger des preuves de recherche avant d’affirmer des faits |
| Hybrid search | FTS + vecteur (RRF) |
| Search source | Arbre indexé nommé sous Sources de recherche |
| Code source pin | Choix conversation ou projet des sources que l’agent peut interroger |
| Working directories | Dossiers absolus ordonnés lecture/écriture ; le premier est cwd |
| needsPin | Réponse d’outil quand plusieurs versions odoo-family sont prêtes et aucune n’est épinglée |
| Prompt Enhancer | Coach des brouillons de conversation |
| Prompt Coach | Coach des prompts durables projet / agent |
| Forge | Changements soul/identité approuvés |
| God Mode | La même tâche est courue en course par le roster de modèles des Paramètres ; un chair départage |
| Security gate | Politique avant l’action |
| CASL | Bibliothèque d’autorisation |
| Orchestration | Solo/Auto/Deep (plus God Mode) |
| Effort | Profondeur de raisonnement |
| SLA breach | Signal proactif de travail overdue ou stale |
| A2A | Protocole agent-à-agent (card + exécution de tâches) |
