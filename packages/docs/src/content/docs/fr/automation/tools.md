---
title: Outils
description: Catalogue des capacités invocables — risque, approbation et affectation aux agents.
---

**À quoi ça sert.** Les outils (tools) sont les actions qu'un agent peut réellement effectuer : lire un fichier, chercher dans un index, ouvrir un navigateur, envoyer un brouillon d'e-mail. Cette page est le catalogue en direct de tout ce qui est enregistré sur cette instance. L'affectation se fait toujours dans l'onglet **Configuration** de l'agent ; ici, vous examinez le nom, la catégorie, le risque et si un appel attend une approbation.

**Chemin :** `/tools`. Barre latérale : **Outils**. Sous-titre : *Outils enregistrés disponibles pour l'exécution des agents.*

## Quand l'utiliser

- Vous voulez savoir quels outils existent avant de mettre leurs identifiants sur un agent.
- Un appel a été bloqué et il vous faut le niveau de risque et savoir s'il **nécessite une approbation**.
- Vous branchez MCP ou une Connexion et voulez voir les outils découverts à côté des outils intégrés.
- Il vous faut le schéma d'entrée d'un outil que l'agent appelle mal sans arrêt.

## Déroulement typique

1. Ouvrez **Outils** dans la barre latérale (`/tools`).
2. Cherchez par nom ou description, ou filtrez par catégorie et niveau de risque.
3. Dépliez **Afficher le schéma** sur une carte quand il vous faut la forme JSON de l'entrée.
4. Mettez l'identifiant de l'outil dans l'onglet **Configuration** de l'agent, dans **Outils (séparés par des virgules)**. Voir [Configurer](/docs/fr/agents/configure/).
5. Les appels dangereux passent toujours le [portail de sécurité](/docs/fr/admin/security-privacy/) à l'exécution — une ligne du catalogue n'accorde aucun droit.

## Fonctions

L'en-tête compte les **outils** et combien **nécessitent une approbation**. Chaque carte affiche un identifiant en chasse fixe, une courte description, un badge de catégorie, un badge de risque (`green risque`, `yellow risque` ou `red risque`) et un bouclier ambré quand une approbation est requise.

| Notion | Signification |
|--------|---------------|
| Nom de l'outil | Identifiant stable utilisé dans la configuration de l'agent et les journaux |
| Description | Ce que fait l'outil (affiché dans le catalogue) |
| Catégorie | Regroupement du registre : `memory`, `knowledge`, `search`, `documents`, `board`, `shell`, `browser`, `conversation`, `communication`, `research`, `agent`, `custom` (les outils MCP et de connexion apportent les leurs) |
| Niveau de risque | **green / yellow / red** — le low / medium / high du portail de sécurité |
| **approbation requise** | L'exécuteur ne lance pas l'appel tant qu'un humain ne l'a pas approuvé |
| Schéma d'entrée | JSON Schema des arguments ; **Afficher le schéma** / **Masquer le schéma** |
| Autorisations | CASL sur l'API plus le portail de sécurité à chaque appel. Un modèle ne peut lancer qu'un outil proposé à son agent : tout autre nom est refusé (*'&lt;tool&gt;' is not in this agent's toolset*), sans demande d'approbation, chez tous les fournisseurs — voir [Configurer — Outils](/docs/fr/agents/configure/#tools--constraints) |
| Sandbox | Certains outils s'exécutent dans des environnements restreints |

Vide : *Aucun outil enregistré pour le moment.* Le chargement (*Chargement des outils…*) et les erreurs de chargement (*Échec du chargement des outils : …*) s'affichent en texte sur la page, pas comme un écran vide.

Les outils adossés à MCP se configurent sous [Serveurs MCP](/docs/fr/ai/mcp/), les identifiants des systèmes externes sous [Connexions](/docs/fr/admin/connections/).

<h3 id="tool-execution-log">Journal d'exécution des outils</h3>

Chaque appel d'outil est inscrit au journal d'exécution des outils : le nom canonique de l'outil, son entrée, sa sortie ou son texte d'erreur, la durée, ainsi que la conversation, l'agent et l'exécution supervisée auxquels il appartient.

- Les appels que lance l'exécuteur d'EYAS — chez les fournisseurs d'API, et les outils EYAS qu'une CLI appelle par le pont EYAS — sont journalisés par l'exécuteur, une fois chacun.
- Les outils qu'une CLI a lancés dans sa propre boucle — Claude Code, Grok CLI et Kimi Code CLI, comme leur shell ou leurs lectures de fichiers — reçoivent aussi une ligne, sous le nom canonique (le `Bash` de Claude Code est journalisé comme `run_command`). EYAS ne les a pas lancés, il ne fait que les enregistrer : ils ont déjà tourné sous les contrôles d'autorisation d'EYAS pour cette CLI.
- Ces lignes sont la preuve d'outils à laquelle le critique de complétude mesure une exécution, et elles alimentent les rapports d'Auto-apprentissage et d'efficacité — de la même façon chez tous les fournisseurs.
- Le journal n'est pas de la mémoire : rien n'en passe dans la mémoire d'EYAS. Seul `memory.l0.captureToolResults` décide si la sortie des outils est enregistrée en mémoire — voir [Mémoire](/docs/fr/knowledge/memory/).

La colonne **Outils** de [Observabilité — Utilisation](/docs/fr/admin/observability/#usage-tab) compte les mêmes appels par trace.

## Champs et contrôles

<h2 id="catalogue">Filtres du catalogue</h2>

| Contrôle | Signification |
|----------|---------------|
| Recherche | *Rechercher des outils…* — correspond au nom ou à la description |
| **Toutes les catégories** | Restreindre à une catégorie du registre |
| **Tous les niveaux de risque** | Restreindre à un niveau de risque |

<h2 id="built-in-tool-groups">Groupes d'outils intégrés (sélection)</h2>

<h3 id="coding-surface">Surface de code (indépendante du modèle)</h3>

Des outils de système de fichiers de premier ordre pour que **chaque** modèle (Grok, Claude API, Kimi, local, …) puisse modifier du code sans dépendre des outils intégrés du SDK Claude Code :

| Outil | Rôle | Risque |
|-------|------|--------|
| `read_file` | Lire un fichier texte (décalage/limite de lignes) | green |
| `write_file` | Créer/écraser un fichier | yellow |
| `edit_file` | Remplacement exact de chaîne (modification ciblée) | yellow |
| `grep` | Recherche de contenu dans le workspace | green |
| `glob` | Trouver des fichiers par motif | green |
| `git_status` / `git_diff` | Aides de relecture en lecture seule | green |
| `run_command` | Exécution de programme sans shell (approbation) | red |

Les chemins sont confinés aux **dossiers de travail** de la conversation (ou au **worktree** de l'agent) — une conversation sans dossiers propres travaille dans son propre workspace EYAS. Il n'y a pas de repli sur le répertoire du processus EYAS. Les chemins sensibles (`.env`, `master.key`, `.ssh`, …) sont refusés, tout comme la mémoire hors d'EYAS — la mémoire d'autres outils, les coffres Obsidian, le dossier de données d'EYAS lui-même et le workspace d'une autre conversation —, en lecture comme en écriture ([Sécurité et confidentialité — Mémoire hors d'EYAS](/docs/fr/admin/security-privacy/#memory-outside-eyas)). Un dossier qui exposerait de la mémoire ou des identifiants ne peut même pas être enregistré comme dossier de travail ([Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders)). Dans un dossier qui ne fait que contenir un tel emplacement — un dépôt contenant le `data/` d'EYAS, `~/Documents` avec un coffre —, `grep` et `glob` ne descendent jamais dans les sous-dossiers protégés (le dossier de données d'EYAS, un coffre Obsidian imbriqué, la mémoire d'un autre outil, un home de CLI, le workspace d'une autre conversation) : une recherche n'en renvoie donc jamais de résultats. Un lien symbolique dans le dossier de travail qui pointe à l'extérieur est refusé, même quand sa cible n'existe pas encore (cela couvre les chemins de `read_file`, `write_file`, `edit_file` et `browser_upload`). Préférez `edit_file` à la réécriture de fichiers entiers.

**git en lecture seule sans clic.** Si l'agent appelle `run_command` (ou un `Bash` de CLI) avec une liste d'arguments qui est sans ambiguïté `git status` ou `git diff` — sans métacaractères de shell, sans `-C` / `--git-dir` / `--no-index`, sans chemin absolu —, le portail de sécurité la remappe sur `git_status` / `git_diff` et **l'autorise**. Vous n'avez pas de demande d'approbation. `git commit`, `git add`, `ls` et toute commande avec métacaractères restent rouges ou sont refusés. Les outils dédiés `git_status` / `git_diff` sont verts.

**Verify before done :** configurez `agent.verifyCommands` en YAML (p. ex. `bun test`) pour lancer des vérifications déterministes après une exécution ; en cas d'échec, l'agent est rouvert avec le résumé de l'erreur.

**Hooks :** chaque appel d'outil passe par les hooks PreToolUse / PostToolUse du ToolExecutor (universels, pas seulement Claude). Les outils intégrés de Claude Code passent en plus le contrôle de la politique mémoire d'EYAS avant de s'exécuter.

**Les modèles CLI utilisent leurs propres outils de fichiers.** Claude Code, Grok et Kimi ne se voient pas proposer cette surface de code (`run_command`, `read_file`, `write_file`, `edit_file`, `grep`, `glob`, `git_status`, `git_diff`) par le pont EYAS, car ils ont les leurs : ils les exécutent dans les dossiers du tour, sous le portail de sécurité, la politique des chemins mémoire et — pour le shell de Claude Code et les outils de Grok — le [sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox). Tous les autres outils EYAS leur parviennent.

<h3 id="search-grounding">Recherche et grounding</h3>

| Outil | Rôle |
|-------|------|
| `list_search_sources` | Lister les sources (libellé, version, édition, famille, chemins, statut) avant d'inventer des faits |
| `get_search_context` | Montrer quelles sources sont épinglées pour cette conversation |
| `set_search_context` | Épingler ou retirer des sources (`sourceIds`, `labels`, `version`, `edition`, ou `clear: true`) |
| `search_indexed` | Recherche hybride FTS + vectorielle avec **citations** ; respecte l'épinglage de la conversation/du projet ; `sourceIds` / `labels` / `version` / `edition` en option |

Quand plusieurs sources **odoo-family** sont prêtes et que rien n'est épinglé, les outils renvoient **`needsPin`** au lieu de mélanger les versions. Voir [Recherche — épinglage multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

<h3 id="memory">Mémoire</h3>

| Outil | Rôle |
|-------|------|
| `memory_search` | Chercher dans la mémoire d'EYAS — résumés, faits, notes du coffre, transcriptions importées —, jamais dans celle de la CLI hôte. En lecture seule et verrouillé par EYAS sur le projet de la conversation, son type et la mémoire globale ; un argument `scope` ou de projet est ignoré. Renvoie des identifiants à ouvrir avec `memory_expand`. |
| `memory_expand` | Ouvrir un résultat par identifiant (`vt:`, `gs:`, `en:`, … — issu de `memory_search` ou d'une ligne de mémoire permanente), dans le même verrou de projet |
| `search_memory` | Alias de `memory_search`, avec le même verrou de projet |
| `save_memory` | Retiré — n'écrit rien. EYAS enregistre la mémoire automatiquement ; les agents n'écrivent jamais la mémoire eux-mêmes |

`memory_search` et `memory_expand` sont toujours disponibles, quoi que dise la liste **Tools** d'un agent, et ce sont les seuls outils de mémoire qu'un modèle reçoit, sur tous les hôtes — fournisseurs d'API, Claude Code, Grok, Kimi, et OpenCode dans une tâche `opencode_run`. Les trois outils de recherche/ouverture partagent un budget de **3 appels par réponse** chez tous les fournisseurs. Un appelant hors d'une conversation EYAS — un client MCP externe, ou une session OpenCode qu'EYAS n'a pas démarrée pour une tâche — ne lit que la mémoire globale, 3 appels par tranche de 90 secondes. `memory_block_read` et `memory_block_write` sont retirés : ce qui était stocké dans des blocs a été copié une fois dans la mémoire d'EYAS et se retrouve avec `memory_search` ; un agent dont la liste les nomme encore ne les reçoit tout simplement plus. Les résultats des outils de mémoire sont masqués par la politique de confidentialité sur tous les transports (fournisseurs d'API, ponts des CLI, clients MCP externes, OpenCode). Voir [Mémoire](/docs/fr/knowledge/memory/).

<h3 id="browser">Navigateur</h3>

Playwright headless (`browser_*`) utilise le même Chromium que la chaîne d'impression des designs. Préférez les index numérotés de `browser_snapshot` au CSS. Les index et le `snapshotId` expirent à la navigation ou au retour arrière — refaites un snapshot. Les cookies persistent dans un profil **propre à EYAS** (`data/browser/profile`, ou `EYAS_BROWSER_USER_DATA_DIR`) — jamais le profil Chrome quotidien (Chrome 136+ bloque le CDP sur le profil Default). Les téléchargements arrivent dans [Documents](/docs/fr/knowledge/documents/).

| Outil | Rôle |
|-------|------|
| `browser_navigate` | Ouvrir une URL ; la protection **SSRF** bloque les hôtes privés/de métadonnées |
| `browser_snapshot` | Arbre d'accessibilité + liste interactive numérotée + `snapshotId` |
| `browser_click` / `browser_fill` / `browser_hover` / `browser_select` | Agir par index ou CSS |
| `browser_tabs` | `list` / `open` / `switch` / `close` (impossible de fermer le dernier onglet) |
| `browser_back` / `browser_wait` | Retour dans l'historique ; attendre un sélecteur, une URL, un chargement ou un délai |
| `browser_dialog` | Armer accepter/refuser pour le prochain `alert`/`confirm`/`prompt` |
| `browser_upload` | Champ de fichier — chemins du workspace ou identifiants de Documents |
| `browser_evaluate` | JavaScript **dans la page** (pas Node) ; résultat JSON plafonné |
| `browser_download` | Prochain téléchargement → Documents, lié à la conversation |
| `browser_storage` | Enregistrer/charger le `storageState` de Playwright (cookies + origines) |
| `browser_replay` / `browser_action_cache` | Rejouer un locator enregistré (sans LLM). JSON dans le projet ou le coffre. Jamais de valeurs saisies |
| `browser_totp` | TOTP depuis Secrets / Trousseau macOS → `browser_fill`. Jaune. La graine n'est jamais renvoyée |
| `browser_screenshot` / `browser_get_content` / `browser_close` | Capture, texte, fin du processus (le profil reste sur le disque) |
| `agent_browser_status` / `agent_browser_run` | Sidecar agent-browser recommandé (références `@e1`, Apache-2.0) — [Browser Use](/docs/fr/automation/browser-use/) |
| `browser_use_status` / `browser_use_exec` | Ancien sidecar CLI Python ([Browser Use](/docs/fr/automation/browser-use/)) |
| `opencode_status` / `opencode_run` | Sidecar facultatif du moteur de code OpenCode ([OpenCode](/docs/fr/automation/opencode/)). Status est vert ; run est rouge + approbation. `opencode_run` ne s'exécute qu'à l'intérieur d'une conversation. Dans la tâche, OpenCode peut lire la mémoire d'EYAS avec les mêmes `memory_search` / `memory_expand` en lecture seule, verrouillés sur le projet de la conversation et partageant le budget de 3 appels du tour appelant ; il ne peut pas écrire la mémoire d'EYAS. |

Les outils navigateur d'EYAS, `agent_browser_*`, `browser_use_*` et `opencode_*` parviennent aussi aux modèles CLI (Claude Code, Grok, Kimi) par le pont EYAS, sous le même portail, les mêmes approbations et la même portée d'outils que pour les modèles d'API.

<h3 id="studio">Studio (module facultatif)</h3>

Des moteurs locaux, pas Médias. Voir [Studio](/docs/fr/studio/).

| Outil | Rôle |
|-------|------|
| `hyperframes_*` | Composition HTML → MP4 déterministe ([Hyperframes](/docs/fr/studio/hyperframes/)) |
| `videouse_*` | Rushes + EDL → MP4 ([Video Use](/docs/fr/studio/videouse/)) |

Le polissage de captures d'écran n'est pas un outil Studio. Recordly est un compagnon AGPL sous [Extensions](/docs/fr/admin/extensions/#recordly) — pas d'outils `recordly_*`.

<h3 id="email">E-mail (brouillon → approbation → envoi)</h3>

| Outil | Rôle |
|-------|------|
| `email_create_draft` | Créer un brouillon local |
| `email_approve_draft` | Marquer le brouillon comme approuvé |
| `email_send_draft` | Envoyer **seulement** s'il est approuvé |

<h3 id="odoo">Odoo (module facultatif)</h3>

**Instance en direct** (JSON-RPC) :

| Outil | Rôle |
|-------|------|
| `odoo_search_tasks` | Chercher des tickets/tâches (surtout en lecture) |
| `odoo_get_task` | Récupérer une tâche |
| `odoo_message_post` | Publier un message dans le chatter |
| `odoo_write_task` | Écriture contrôlée |

**Index de sources local** (chaîne de développement) :

| Outil | Rôle |
|-------|------|
| `odoo_search_model` | Trouver `_name` / `_inherit` dans le Python local |
| `odoo_search_field` | Trouver les affectations `fields.*` |
| `odoo_search_xml_id` | Trouver des identifiants d'enregistrements XML |

Les racines se résolvent depuis : **épinglage** de la conversation/du projet → Sources de recherche (`family: odoo`) → `EYAS_ODOO_SOURCES_JSON` / `EYAS_ODOO_SOURCE_PATHS`. Filtres d'outil facultatifs : `label`, `labels`, `sourceIds`, `version`, `edition`. Citations : `[source:odoo-src:label:file:line]`.

Skill : `coding/odoo/odoo-dev-chain`. Identifiants en direct via [Connexions](/docs/fr/admin/connections/) (type Odoo). Plusieurs versions dans l'interface : [Recherche](/docs/fr/daily/search/) · [Projets](/docs/fr/daily/projects/) · onglet **Sources** de la conversation.

<h3 id="connections-inventory">Inventaire des connexions</h3>

| Outil | Rôle |
|-------|------|
| `connections_list` / `connections_catalog` | Inventaire + catalogue |
| `connections_test` | Contrôle de santé |
| `connections_propose` | Proposer une connexion à l'approbation humaine |

<h3 id="media">Médias (module facultatif)</h3>

Connectez Magnific, Higgsfield, fal ou HeyGen sous [Médias](/docs/fr/ai/media/). Les agents reçoivent cinq outils partagés, pas un par modèle de fournisseur. Vidéo de présentateur / talking head : épinglez `provider: heygen`.

| Outil | Rôle | Risque |
|-------|------|--------|
| `media_generate` | Lancer image / vidéo / audio / upscale / retouche / 3D | yellow |
| `media_wait` | Interroger jusqu'à la fin du job | yellow |
| `media_catalog` | Lister les modèles d'un type | green |
| `media_balance` | Crédits restants | green |
| `media_history` | Jobs récents | green |

Les fichiers terminés entrent dans [Documents](/docs/fr/knowledge/documents/) et sont joints au tour qui les a produits.

<h3 id="other-groups">Autres groupes enregistrés</h3>

Ils apparaissent dans le catalogue quand leur module est activé : outils **board**, **conversation**, **document**, **knowledge**, **research**, **schedule**, **channel** envoyer/lister, **A2A delegate**, et en option **Google Docs**.

Routage d'agents (enregistré par le module agent, non dupliqué dans ce catalogue) :

| Outil | Rôle | Risque |
|-------|------|--------|
| `run_specialist` | Lancer un spécialiste activé et attendre le résumé. Alias : `delegate_to_agent`. Le seul moyen de lancer des spécialistes chez tous les fournisseurs — l'outil de sous-agents propre à Claude Code n'est pas proposé. | green |
| `handoff_to_colleague` | Ouvrir le fil d'accueil d'un autre collègue et y lancer tout de suite une exécution, avec le brief comme objectif ; refusé tant que ce fil est occupé. | green |
| `assign_task` | Carte de tableau asynchrone pour un agent activé. | green |
| `propose_team` | Carte pour des rôles manquants, un travail d'envergure ou une demande d'équipe explicite. | yellow |
| `propose_agent_creation` | Proposer un nouveau modèle de spécialiste. | yellow |

Voir [Équipes et délégation](/docs/fr/agents/teams/).

<h3 id="cli-mcp-parity">Parité CLI MCP</h3>

Quand des agents tournent sur **Grok CLI** ou **Kimi Code CLI**, EYAS injecte un pont MCP stdio pour que ces hôtes partagent les mêmes outils ToolExecutor que les sessions in-process / Claude Code — outils de mémoire compris. Chaque tour a son propre secret, lié côté serveur à cette conversation, cet agent, ce projet, ces dossiers et cette portée d'outils, et les appels relayés passent toujours par le portail de sécurité. Sur les deux ponts — le serveur MCP EYAS in-process de Claude Code et le pont Grok/Kimi —, une CLI reçoit exactement la liste **Tools** de l'agent plus `memory_search` / `memory_expand` (tous les outils si la liste est vide), aucun outil de délégation dans une conversation Solo, et pas les outils pour lesquels l'équivalent propre de la CLI est autorisé (`read_file`, `grep`, `glob` toujours ; `write_file`, `edit_file` tant que la liste autorise l'écriture ; `run_command`, `git_status`, `git_diff` tant qu'elle autorise le shell). La même liste limite aussi les outils d'écriture, de shell et web propres de la CLI (voir [Agents — Outils](/docs/fr/agents/configure/#tools--constraints)). Un appel à tout autre outil est refusé et s'affiche comme **Refusé**. EYAS teste le pont à chaque démarrage et journalise un avertissement quand Grok/Kimi n'atteignent pas les outils EYAS. Chaque hôte nomme les outils à sa façon (Grok : `use_tool` avec `eyas__<nom>`). Voir [MCP](/docs/fr/ai/mcp/#cli-mcp-tool-parity-grok--kimi).

## Voir aussi

- [Agents — configurer les outils](/docs/fr/agents/configure/)
- [Équipes et délégation](/docs/fr/agents/teams/)
- [Portail de sécurité](/docs/fr/admin/security-privacy/)
- [Connexions](/docs/fr/admin/connections/)
- [Skills](/docs/fr/automation/skills/)
- [Serveurs MCP](/docs/fr/ai/mcp/)
- [OpenCode](/docs/fr/automation/opencode/)
- [Médias](/docs/fr/ai/media/)
- [Studio](/docs/fr/studio/)
- [Browser Use](/docs/fr/automation/browser-use/)
- [Extensions](/docs/fr/admin/extensions/#recordly)
