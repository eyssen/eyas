---
title: Glossaire
description: Termes produit.
---

| Terme | Définition |
|-------|------------|
| Agent | Acteur IA configuré |
| Collègue | Agent principal ou d’équipe à qui vous parlez ; un fil d’accueil par collègue (barre **Collègues**) |
| Primary | Collègues always-on issus de l’installation (Assistant personnel + Ingénieur système) |
| Spécialiste | Travailleur étroit qu’un collègue peut lancer (`run_specialist`) |
| Fil d’accueil | Une conversation continue par collègue |
| Skill | Paquet de procédure markdown |
| Proposition de compétence | Skill qui matche et que le tour attend — **L'utiliser**, **Pas cette fois**, ou owner/admin **Désactiver** |
| Outil | Capacité invocable |
| Coding surface | Outils fichier agnostiques au modèle (`read_file`, `edit_file`, `grep`, …) d’EYAS |
| Worktree | Arbre git isolé pour spécialistes rédacteurs en parallèle (`.eyas-worktrees/`) |
| Verify commands | Lint/test après une exécution, avant le critique LLM |
| Tool hook | PreToolUse / PostToolUse à chaque exécution |
| Issue d’outil | Le statut final d’un appel d’outil dans la trace : *Réussi*, *Échec*, *Refusé*, *Approbation requise* ou *Ignoré* (*Issue inconnue* si le tour s’est terminé avant). Une ligne ne passe au vert que si l’outil a réellement rendu compte, de la même façon chez tous les fournisseurs ([Trace des outils](/docs/fr/daily/conversations/#tool-trace)) |
| Journal d’exécution des outils | L’enregistrement de chaque appel d’outil : nom canonique, entrée, sortie ou erreur, durée, conversation, agent et exécution. Il inclut les outils qu’une CLI a lancés dans sa propre boucle (le `Bash` de Claude Code est journalisé comme `run_command`). Le critique de complétude et l’Auto-apprentissage le lisent ; rien n’en passe dans la mémoire ([Outils](/docs/fr/automation/tools/#tool-execution-log)) |
| Tableau | Surface de suivi du travail |
| Conversation | Fil de chat |
| Issue du tour | Comment un tour de chat s’est terminé, en un badge sous la réponse : aucun s’il s’est achevé, sinon *Limite de tours atteinte*, *Limite de sortie atteinte*, *Refusé par le modèle*, *Budget d'outils épuisé*, *Arrêté*, *Échec* ou *En attente d'approbation*. La réponse écrite jusque-là est toujours conservée ([Issue du tour](/docs/fr/daily/conversations/#turn-outcome)) |
| Niveau mémoire | Working→episodic→vault→archive |
| Enregistrement brut (L0) | Une deuxième copie mot pour mot, compressée, de chaque message qu’EYAS conserve, plus la sortie des outils et le raisonnement du modèle quand ces interrupteurs sont activés. Les modèles n’y accèdent que par le rappel ; la sortie d’outil et le raisonnement enregistrés ne sont jamais rappelés. Interrupteur : `memory.l0.enabled` ([L’enregistrement brut](/docs/fr/knowledge/memory/#the-raw-record)) |
| Niveau de confiance | Qui a écrit un texte mémorisé : *owner*, *derived*, *peer*, *ingested* ou *quarantined*. Un fait ou un résumé n’a jamais plus de confiance que le texte dont il vient. Poids dans le rappel : 1 / 1 / 0,3 / 0,6 / jamais ([Confiance : qui l’a écrit](/docs/fr/knowledge/memory/#trust-who-wrote-it)) |
| Périmètre du projet | La mémoire qu’une conversation peut voir : celle de son projet, celle de son type de projet et la mémoire globale — jamais celle d’un autre projet. EYAS l’impose sur le serveur pour le rappel et chaque outil mémoire, quoi que le modèle envoie ([Quelle mémoire une conversation peut voir](/docs/fr/knowledge/memory/#which-memory-a-conversation-can-see)) |
| Identifiant de mémoire | L’identifiant d’une ligne rappelée, que `memory_expand` ouvre. Son préfixe nomme la couche : `vt:` note du vault, `gs:` résumé, `ft:` fait, `en:` entité, `ep:` épisode, `rw:` enregistrement brut (un message antérieur). Observabilité compte la mémoire transmise selon ces codes |
| Memory block | Retiré : les anciennes notes partagées que les agents lisaient/écrivaient via les outils `memory_block_*`, copiées une fois dans la mémoire EYAS lors de la mise à jour |
| Vault | Connaissance markdown long terme |
| Capture run | Une extraction de mémoire durable post-tour ; chaque résultat écrit `memory_capture_runs`. Interrupteur : `memory.capture.enabled` |
| Canevas de design | Multi-artboard `.dc.html` + `canvas.json`, format Claude Design avec runtime EYAS |
| Fournisseur | Backend LLM |
| Type de fournisseur | `cli` (Claude Code CLI, Grok CLI, Kimi Code CLI), `local` (Ollama, LM Studio, vLLM) ou `api` (toute API hébergée). `GET /api/v1/model/providers` le renvoie à côté du nom du produit, et la page Fournisseurs et l’assistant de configuration reconnaissent un fournisseur CLI grâce à lui ([Fournisseurs](/docs/fr/ai/providers/#built-in-providers)) |
| Modèle fixe | Le modèle sur lequel une conversation tourne et qu’elle garde. Une nouvelle conversation qui n’en nomme aucun reçoit le défaut de l’install à son premier message ; changer les défauts plus tard ne la déplace pas. Un modèle choisi dans le sélecteur de modèle n’est jamais remplacé en silence : s’il devient indisponible, le message est refusé |
| Sélecteur de modèle | La commande de la barre supérieure de la conversation qui choisit un modèle fixe, le routage automatique ou le modèle par défaut du collègue, et dit quel modèle répond au prochain message et pourquoi |
| Auto-routage | Un choix par conversation : seule une conversation réglée sur Auto voit ses messages classés et routés entre les niveaux, et seulement tant que **Autoriser le routage automatique** est activé |
| Par défaut du collègue | Une conversation avec un collègue (et une sous-conversation) suit le modèle de ce collègue, sinon celui de la conversation qui délègue, sinon le défaut ; si le modèle du collègue est indisponible, le tour se rabat avec une note, jamais en silence |
| Modèle d’arrière-plan | Le modèle sur lequel tourne le travail d’arrière-plan d’EYAS (titres, heartbeat, capture mémoire, juge de sécurité, recherche, …) — uniquement un fournisseur capable de faire des appels isolés, essayé dans un ordre de niveaux fixe. La carte **Appels de modèle en arrière-plan** des Niveaux de routage montre où part chaque groupe |
| Sandbox de fichiers du noyau | Le sandbox de fichiers du système d’exploitation (macOS Seatbelt, Linux bubblewrap) dans lequel tournent les commandes shell de Claude Code et les propres outils de Grok CLI, et qui bloque la mémoire hors d’EYAS et les données privées d’EYAS ; Kimi Code CLI n’en a pas. `security.cliSandbox: auto \| required` |
| Quarantaine (mémoire d’un fournisseur) | Action du propriétaire sur Mémoire → Aperçu qui cache à tous les modèles ce qu’un fournisseur a écrit, et peut la lever plus tard ; rien n’est supprimé |
| Home CLI | Dossier propre à EYAS dans lequel tournent Grok CLI, Kimi Code CLI et OpenCode (`<data dir>/cli-homes/<provider>`) au lieu de la configuration de l’opérateur ; contient leur connexion pour EYAS. Claude Code garde le home de l’hôte et n’en partage que sa connexion |
| Se connecter pour EYAS | Connexion de Grok CLI / Kimi Code CLI faite pour le home CLI propre à EYAS (code d’appareil, ou une clé API xAI pour Grok) — la connexion de l’hôte n’est pas utilisée |
| Vérification d’isolation | Le contrôle par lequel EYAS s’assure qu’une CLI (Claude Code, Grok, Kimi) n’a rien chargé de l’hôte ; un tour qui échoue s’arrête et n’est jamais confié à un autre modèle |
| Vérification de publication | `bun run test:live-cli`, avant une publication : les vrais Claude Code et Grok CLI (et Kimi Code CLI là où il est installé) tournent via EYAS dans un home jetable rempli de pièges, pour prouver que rien de l’hôte n’est chargé et que la mémoire hors d’EYAS reste refusée. Sa partie gratuite utilise un faux modèle local et ne consomme aucun jeton ([Comment l’isolation est prouvée](/docs/fr/admin/security-privacy/#how-isolation-is-proven)) |
| Version de CLI prouvée | La version de CLI sur laquelle la vérification de publication a réussi en dernier : Claude Code 2.1.281 et Grok CLI 1.0.41 ; Kimi Code CLI pas encore. `eyas doctor` avertit quand la version installée diffère ; chaque session reste vérifiée à son démarrage ([Versions de CLI prouvées](/docs/fr/ai/providers/#proven-cli-versions)) |
| Bloc du tour | Le bloc `<turn-context>` qu’EYAS place en tête de votre message courant à chaque tour : la date et l’heure courantes, puis le bloc de rappel. Il est reconstruit à chaque tour et envoyé seulement au modèle — jamais enregistré avec votre message —, si bien que le prompt système reste identique d’un tour à l’autre ([Comment le rappel atteint le modèle](/docs/fr/knowledge/memory/#how-recall-reaches-the-model)) |
| Bloc de rappel | Le bloc délimité `<eyas-memory>` dans le bloc du tour : les notes permanentes, les notes récupérées pour ce message et le texte intégral des meilleures correspondances. Identique chez tous les fournisseurs, dimensionné selon la fenêtre de contexte du modèle qui répond |
| Approfondissement (drill-down) | Le modèle ouvre lui-même la mémoire avec `memory_search` / `memory_expand` : 3 appels par réponse chez tous les fournisseurs, toujours dans le périmètre du projet de la conversation. Chaque hôte nomme les outils à sa façon (`mcp__eyas__memory_search` dans Claude Code, `use_tool` avec `eyas__memory_search` dans Grok CLI) ; un modèle qui ne peut pas appeler d’outils n’a pas d’approfondissement et reçoit à la place davantage de notes en texte intégral ([Chercher plus loin : memory_search et memory_expand](/docs/fr/knowledge/memory/#looking-further-memory_search-and-memory_expand)) |
| Profil de transmission | Ce qu’EYAS sait du modèle qui répond à un tour : sa fenêtre de contexte, s’il appelle des outils, comment son hôte nomme les outils EYAS et s’il peut approfondir. Le prompt et le bloc de rappel sont dimensionnés d’après lui, et un modèle qui ne peut pas appeler d’outils n’en reçoit aucun. L’encadré **Mémoire transmise** le montre à chaque tour ([Composition du contexte](/docs/fr/daily/conversations/#context-composition)) |
| Moteur de rappel | Ce par quoi chaque modèle se rappelle : un embedder local (multilingual-e5-small, sinon un repli par hachage), des vecteurs rangés par partition de projet, une requête et un classement. Affiché en lecture seule dans la carte **Moteur de rappel** de **Mémoire → Aperçu** ([Moteur de rappel](/docs/fr/knowledge/memory/#recall-engine)) |
| Transmission de la mémoire par fournisseur | La carte d’**Observabilité → Contexte** qui compare les fournisseurs : tours qui ont porté de la mémoire, éléments moyens par couche, jetons de mémoire et consultations de la mémoire par tour. Des chiffres proches signifient que chaque modèle a reçu la même mémoire ([Observabilité et opérations](/docs/fr/admin/observability/#memory-delivery-by-provider)) |
| Mémoire hors d’EYAS | La mémoire d’autres outils, les coffres de notes et le dossier de données propre à EYAS — refusés à tous les modèles, en lecture comme en écriture |
| MCP | Model Context Protocol |
| Connection | Entrée d’inventaire d’un système externe (Odoo, GitHub, MCP, …) |
| Canal | Connecteur de messagerie externe — pas Connection, pas Main |
| Main (Hand) | Client local apparié avec outils OS/CLI/bureau ([Mains](/docs/fr/admin/hands/)) |
| Médias | Passerelle hébergée prompt→pixels (Magnific, Higgsfield, fal, HeyGen). Cinq outils `media_*` ; aucun n’est le défaut. ([Médias](/docs/fr/ai/media/)) |
| HeyGen | Backend optionnel de vidéo talking-head / présentateur sous Médias (OAuth MCP, crédits du plan web). Pas Studio. ([Médias](/docs/fr/ai/media/)) |
| Studio | Moteurs de production locaux (HTML ou rushes → fichier). Pas Media. ([Studio](/docs/fr/studio/)) |
| Video Use | Moteur Studio qui coupe des rushes depuis un EDL ([Video Use](/docs/fr/studio/videouse/)) |
| Browser Use | Sidecar CLI optionnel pour un Chrome connecté via CDP ([Browser Use](/docs/fr/automation/browser-use/)) |
| OpenCode | Sidecar optionnel du moteur de code MIT (HTTP 127.0.0.1 + TUI web). Pas vendored. ([OpenCode](/docs/fr/automation/opencode/)) |
| Plugin mémoire d’OpenCode | Donne au modèle d’OpenCode les outils EYAS en lecture seule `memory_search` / `memory_expand`, et aucun outil qui écrit la mémoire. Une tâche `opencode_run` lit le périmètre du projet de sa conversation, les autres sessions seulement la mémoire globale, et un serveur externe rattaché aucune. Chaque processus OpenCode qu’EYAS démarre a sa propre clé, qui meurt avec le processus ([Mémoire EYAS dans OpenCode](/docs/fr/automation/opencode/#eyas-memory-inside-opencode)) |
| Nœud distant | Autre machine que cette instance atteint (SSH et amis) ([Nœuds](/docs/fr/admin/nodes/)) |
| Pack d’extension | Pack de skills tiers du catalogue, check MIT ([Extensions](/docs/fr/admin/extensions/)) |
| Recordly | Enregistreur d’écran bureau AGPL ; compagnon tiers via Extensions, non livré, pas un moteur Studio ([Recordly](/docs/fr/admin/extensions/#recordly)) |
| Grounding | Exiger des preuves de recherche avant d’affirmer des faits |
| Hybrid search | FTS + vecteur (RRF) |
| Search source | Arbre indexé nommé sous Sources de recherche |
| Code source pin | Choix conversation ou projet des sources que l’agent peut interroger |
| Working directories | Dossiers nommés (nom + chemin absolu) lecture/écriture ; le premier est cwd. Type et/ou projet ; la conversation hérite. Les outils fichier y sont enfermés — une conversation qui n’en a aucun reçoit son propre espace de travail EYAS |
| Espace de travail EYAS | Le dossier qu’EYAS crée pour une conversation sans répertoires de travail propres ; jamais dans un checkout git (`EYAS_WORKSPACES_DIR` pour le déplacer) |
| Plan d’abord | Mode du compositeur : le modèle écrit un plan et attend **Approuver** / **Ignorer le plan** / **Rejeter** avant les outils |
| Skill import roots | `skills.importRoots` / `agent.importRoots` dans `local.yaml` — dossiers markdown supplémentaires, relus à chaque démarrage. Défaut vide. Les racines situées dans les dossiers d’un autre outil sont ignorées |
| Wiki projet | Pages par projet (`/projects/:id/wiki`) ; auto-update optionnel depuis tickets fermés et décisions d’équipe |
| needsPin | Réponse d’outil quand plusieurs versions odoo-family sont prêtes et aucune n’est épinglée |
| Prompt Enhancer | Coach des brouillons de conversation |
| Prompt Coach | Coach des prompts durables projet / agent |
| Forge | Changements soul/identité approuvés |
| God Mode | La même tâche est courue en course par le roster de modèles des Paramètres ; un chair départage |
| Security gate | Politique avant l’action |
| CASL | Bibliothèque d’autorisation |
| Orchestration | Solo/Auto/Deep : politique des spécialistes (plus God Mode) |
| Effort | Profondeur de raisonnement (Auto, Aucun, Minimal, Faible, Moyen, Élevé, Très élevé, Max). Le sélecteur ne liste que les niveaux que propose le modèle ; Auto hérite (Deep → Max, collègue, conversation qui délègue, niveau de routage) ou utilise le défaut du modèle ; chaque appel est ajusté à ce que le modèle qui répond prend en charge et chaque réponse affiche l’effort avec lequel elle a tourné |
| Niveau relu | Claude Code CLI, Grok CLI et Kimi Code CLI rapportent le niveau d’effort avec lequel ils ont réellement tourné, et c’est ce que montrent la réponse et sa trace. Chez tous les autres fournisseurs, c’est le niveau qu’EYAS a envoyé après l’avoir ajusté au modèle ([Comment chaque fournisseur applique le niveau d’effort](/docs/fr/ai/providers/#effort-by-provider)) |
| SLA breach | Signal proactif de travail overdue ou stale |
| A2A | Protocole agent-à-agent (card + exécution de tâches) |
