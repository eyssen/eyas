---
title: Serveurs MCP
description: Model Context Protocol — serveurs actifs, installation depuis le catalogue, blocage des stockages de mémoire et parité d'outils des CLI.
---

**À quoi ça sert.** MCP (Model Context Protocol) est la manière dont EYAS branche des boîtes à outils *externes* : un serveur de système de fichiers, un MCP SaaS, un processus `npx` local. Les outils découverts ici s'affectent comme les outils intégrés. Ce n'est ni un [canal](/docs/fr/communication/channels/) de chat ni une ligne de l'inventaire des [Connexions](/docs/fr/admin/connections/) — même si vous pouvez aussi enregistrer un serveur MCP comme Connexion pour suivre son état.

**Chemin :** `/mcp-settings` (barre latérale **Serveurs MCP**). Titre : **Serveurs MCP**. Sous-titre : *Étendez EYAS avec des outils, ressources et prompts externes via le Model Context Protocol.* Onglets : **Actifs** · **Catalogue**.

## Quand l'utiliser

- Un agent a besoin d'outils qu'EYAS ne fournit pas (un MCP de fournisseur, un serveur de système de fichiers local).
- Un agent Grok ou Kimi n'atteint pas les outils EYAS et il vous faut le résultat de l'auto-test du pont.
- Vous voulez une installation en un clic depuis le catalogue (clé API) plutôt que taper une commande.
- Les sessions Grok/Kimi CLI doivent voir les mêmes outils ToolExecutor que les agents in-process.
- Un serveur est déconnecté et il vous faut **Tester** / le nombre d'outils découverts.
- Un serveur affiche **Bloqué : stockage de mémoire**, ou une installation a été refusée parce qu'elle conserverait de la mémoire hors d'EYAS.

## Déroulement typique

1. Ouvrez **Serveurs MCP** (`/mcp-settings`).
2. Parcourez le **Catalogue** et filtrez par catégorie. Sections : **Prêt à l'emploi** / **Installation en un clic (clé API requise)** / **Tiers (configuration manuelle)** / **Indisponible — mémoire hors d'EYAS**.
3. **Installer** (renseignez les clés si on vous les demande, puis **Installer et connecter**) ou **Manuel** → **Ajouter un serveur MCP** (nom, transport, commande ou URL).
4. Sur **Actifs**, vérifiez que le serveur est connecté, lancez **Tester** et examinez les outils / ressources / prompts découverts.
5. Affectez ces identifiants d'outils dans l'onglet **Configuration** de l'agent. Voir [Outils](/docs/fr/automation/tools/).

## Fonctions

L'en-tête affiche **N/M connectés**. Les entrées du catalogue portent un badge de **licence** (compatible MIT / copyleft / propriétaire / inconnue) — copyleft et propriétaire tournent quand même comme **processus distinct** ; EYAS reste sous MIT.

Vous pouvez aussi enregistrer un serveur MCP comme ligne de l'inventaire des [Connexions](/docs/fr/admin/connections/) (type **MCP server**) pour suivre son état à côté d'Odoo, GitHub, etc.

Magnific, Higgsfield, fal et HeyGen se connectent sous [Médias](/docs/fr/ai/media/) ; l'agent utilise cinq outils `media_*` au lieu de leurs catalogues MCP bruts.

**Agent Browser** (Vercel, Apache-2.0) est une ligne de catalogue Browser : `agent-browser mcp --tools core,state`. Installez d'abord la CLI (`EYAS_AGENT_BROWSER_BIN` ou PATH). Jamais `--tools all` (cela inclut `chat`). Voir [Browser Use](/docs/fr/automation/browser-use/).

**Chrome DevTools MCP** (Google, Apache-2.0) est une ligne de catalogue **DevTools** : `npx -y chrome-devtools-mcp@latest --isolated` avec la télémétrie désactivée et `--categoryExperimentalWebmcp=true`. Pour le code et le débogage uniquement (console, réseau, Lighthouse, WebMCP) — **pas** pour remplir des formulaires. Les outils arrivent sous `mcp_chrome-devtools_*`. Les outils WebMCP (`list_webmcp_tools` / `execute_webmcp_tool`) n'apparaissent que si le sidecar les annonce ; sinon ils ne sont pas inventés. `--autoConnect` et le profil Chrome quotidien sont refusés. Voir [Browser Use](/docs/fr/automation/browser-use/#chrome-devtools-mcp).

## Champs et contrôles

<h2 id="active">Serveurs actifs</h2>

Chaque carte de serveur affiche le nom, un point d'état, le transport, la commande ou l'URL, et des badges :

| Contrôle | Signification |
|----------|---------------|
| **désactivé** | Le serveur existe mais n'est pas activé |
| **Bloqué : stockage de mémoire** | Le serveur conserve de la mémoire hors d'EYAS ou pointe vers un dossier protégé. Il n'est jamais démarré et ses outils n'atteignent aucun modèle ; **Tester** et **Actualiser** sont désactivés, **Modifier** et **Supprimer** fonctionnent toujours — voir [plus bas](#memory-store-servers-are-blocked) |
| **OAuth** / **Clé API** | Comment le serveur s'authentifie (pas de badge s'il n'en a pas besoin) |
| **Connexion OAuth** | Serveurs OAuth : lance la connexion dans le navigateur (`POST …/oauth/start` → redirection). Magnific et Higgsfield affichent **Connexion Magnific / Higgsfield (OAuth)** |
| **Géré par Paramètres → Médias** | Affiché quand le serveur appartient à Médias (`ownedBy` vaut `media`) |
| **N outils / N ressources / N prompts** | Catalogue découvert |
| **Tester** → **Connexion OK / Échec du test** | Sonder la connexion ; le résultat du dernier test |
| **Actualiser** | Redécouvrir les outils du serveur |
| **Modifier** / **Supprimer** | Changer la commande, l'URL ou la clé API ; retirer le serveur |

<h2 id="add-server">Boîte de dialogue d'ajout / de modification</h2>

**Manuel** ouvre **Ajouter un serveur MCP** (**Modifier le serveur MCP** pour un serveur existant) :

| Champ | Signification |
|-------|---------------|
| **Nom** | Identifiant affiché |
| **Transport** | **stdio (processus local)** · **HTTP (distant)** · **SSE (HTTP en flux)** — le transport `sse` est du Streamable HTTP ; n'ajoutez **pas** `/sse`. EYAS gère l'en-tête de session. |
| **Commande** / **Arguments** | stdio uniquement : le processus (`npx`) et ses arguments séparés par des espaces |
| **URL** | HTTP / SSE uniquement : le point de terminaison (sans suffixe `/sse`) |
| **Clé API (facultatif)** | HTTP / SSE uniquement : envoyée comme jeton Bearer |

Les serveurs qui se connectent par OAuth viennent du catalogue ou de Médias ; la boîte de dialogue n'a pas d'option OAuth.

<h2 id="catalog">Catalogue</h2>

| Contrôle | Signification |
|----------|---------------|
| Filtre de catégorie | **Tous (N)** plus une par catégorie |
| **Installer / Installé** | En un clic, ou déjà présent |
| **Guide de configuration** / **Masquer le guide de configuration** | Déplier les instructions du fournisseur |
| Boîte de dialogue des clés | Clés requises avant **Installer et connecter** |
| Mention de licence | *Sous licence … S'exécute en processus distinct — EYAS reste sous MIT.* |

Liste des actifs vide : *Aucun serveur MCP configuré* — **Parcourir le catalogue**.

<h3 id="memory-store-servers-are-blocked">Les serveurs de stockage de mémoire sont bloqués</h3>

Un serveur MCP qui conserve une seconde mémoire hors d'EYAS deviendrait une source vivante de lecture/écriture pour chaque modèle. Ces serveurs sont bloqués pour tous les modèles — fournisseurs d'API, Claude Code, Grok CLI et Kimi CLI pareillement. EYAS ne lit et n'écrit la mémoire que via ses propres stockages ; pour faire entrer une autre mémoire, passez par une importation à sens unique (**Paramètres → Système → Portabilité des données → Importer des données**, voir [Importation de données](/docs/fr/admin/data-port/)).

Ce qui compte comme stockage de mémoire :

- Les entrées de catalogue **Memory** (serveur de graphe de connaissances), **Qdrant** et **Obsidian**. Elles sont listées sous **Indisponible — mémoire hors d'EYAS**, avec **Installer** désactivé, une courte explication et un bouton **Aller à Portabilité des données**.
- Un serveur ajouté à la main dont la commande ou les arguments nomment un paquet ou un binaire de mémoire connu : le serveur de mémoire de référence MCP (`@modelcontextprotocol/server-memory`, `mcp-server-memory`), MCPVault (`@bitbonsai/mcpvault`, `mcpvault`), les serveurs MCP Obsidian (`mcp-obsidian`, `obsidian-mcp`, `obsidian-mcp-server`), Basic Memory, Mem0/OpenMemory, et les paquets des entrées de catalogue signalées (par exemple `mcp-server-qdrant`). Un suffixe de version n'y change rien. Seuls les noms de paquets et de binaires sont comparés, jamais le nom affiché : un serveur simplement *appelé* « memory » s'installe normalement.
- Un serveur dont un argument, une valeur `--flag=value`, une valeur de variable d'environnement, le chemin de la commande ou une URL `file://` pointe vers un dossier protégé : la mémoire ou l'état d'un autre outil (`~/.claude`, `~/.grok`, `~/.codex`, `~/.gemini`, `~/.kimi`, `~/.cursor`, `~/.codeium`, les dossiers d'OpenCode, des dossiers `ai-memory`, un coffre Obsidian, des entrées de `security.foreignMemoryPaths`), le dossier de données d'EYAS lui-même (coffre, base de données, clés — les workspaces des conversations restent autorisés) ou les homes de CLI propres à EYAS. Un serveur Filesystem pointé vers un coffre Obsidian ou vers `data/vault` est bloqué ; un serveur pointé vers un dossier de projet ordinaire est accepté. Les serveurs qu'EYAS lance depuis `data/mcp-servers/` — le dossier où `config/mcp.yaml` les clone — sont du code de serveur, pas de la mémoire, et sont autorisés (jugés sur leur chemin réel : un lien de là vers le coffre reste bloqué).

**Ce qui se passe.** Installer depuis le catalogue, ajouter à la main ou modifier un serveur jusqu'à une telle configuration est refusé, avec un message traduit, et rien n'est enregistré. Les serveurs configurés avant l'existence du blocage ne sont pas supprimés : au démarrage, ils sont marqués **Bloqué**, jamais démarrés, et aucun de leurs outils `mcp_*` n'atteint un modèle. L'onglet **Actifs** affiche un badge **Bloqué : stockage de mémoire** avec la raison et un lien vers l'importation de données. Si la politique ne signale plus un serveur (par exemple parce qu'un dossier a été retiré de `security.foreignMemoryPaths`), il quitte l'état Bloqué au démarrage suivant. Les entrées de `config/mcp.yaml` qui sont des stockages de mémoire sont ignorées avec une erreur dans le journal.

**Migration.** Les installations existantes perdent un serveur Memory, Qdrant, Obsidian ou MCPVault qui fonctionnait, et tout serveur pointé vers un coffre ou vers la mémoire d'un autre outil. C'est voulu : copiez cette mémoire dans EYAS une fois, avec l'importation de données.

**API (intégrateurs).** `GET /api/v1/mcp/servers` inclut `blocked: 'memory_store' | null` par serveur (statut `blocked`). `POST /api/v1/mcp/servers`, `PUT /api/v1/mcp/servers/:id`, `POST /api/v1/mcp/registry/:id/install` et `POST /api/v1/mcp/servers/:id/refresh` répondent `409 {error, code: 'memory_store_blocked'}` ; `POST /api/v1/mcp/servers/:id/test` renvoie `{ok: false, code: 'memory_store_blocked'}`. Les entrées de catalogue portent `memoryStore: true`.

---

<h2 id="cli-mcp-tool-parity-grok--kimi">Parité des outils MCP des CLI (Grok / Kimi)</h2>

Les fournisseurs d'API et in-process partagent déjà les outils EYAS. Pour les fournisseurs **CLI hôtes** :

| Fournisseur | Comportement |
|-------------|--------------|
| **Claude Code** | Serveur MCP in-process nommé `eyas`, appelé comme `mcp__eyas__<name>`. Il ne passe pas par le pont stdio ci-dessous et ne dépend donc pas de son auto-test au démarrage. C'est le seul serveur MCP que Claude Code charge. |
| **Grok CLI / Kimi Code CLI** | Serveur MCP stdio + pont en boucle locale (`/api/v1/internal/cli-mcp/tools/list` et `/tools/call`) avec un secret par tour ; le `session/new` d'ACP reçoit `mcpServers` pour que la CLI puisse appeler les mêmes outils ToolExecutor. C'est le seul serveur MCP auquel elles peuvent se connecter : les serveurs MCP de l'hôte et du projet ne sont pas chargés (voir [Fournisseurs](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli)). |

OpenCode n'est pas un hôte MCP ici : dans une tâche `opencode_run`, il reçoit `memory_search` / `memory_expand` du plugin de mémoire d'EYAS (voir [plus bas](#tool-names-per-host) et [OpenCode](/docs/fr/automation/opencode/)).

**Quels outils EYAS une CLI reçoit.** Une seule règle pour les deux ponts : chaque outil EYAS de la portée de l'agent — sa liste **Tools** plus `memory_search` et `memory_expand` (une liste vide signifie tous les outils), sans `run_specialist`, `delegate_to_agent`, `handoff_to_colleague` ni `propose_team` dans une conversation **Solo** — **sauf** ceux pour lesquels la CLI a un équivalent propre autorisé : `read_file`, `grep` et `glob` (les outils de lecture de la CLI sont toujours autorisés), `write_file` et `edit_file` tant que la liste de l'agent autorise l'écriture, et `run_command`, `git_status` et `git_diff` tant qu'elle autorise le shell. Pour ceux-là, la CLI utilise son propre shell et ses outils de fichiers dans les dossiers du tour, sous le [sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox) et la politique des chemins mémoire. Un outil EYAS dont l'équivalent CLI n'est pas autorisé est proposé à la place par le pont — `git_status` et `git_diff` sur une liste sans `run_command`. La liste **Outils** de l'agent limite aussi les outils d'écriture, de shell et web propres de la CLI (voir [Agents — Outils](/docs/fr/agents/configure/#tools--constraints)). Les modèles CLI reçoivent aussi les outils navigateur d'EYAS (`browser_*`, y compris les sessions enregistrées et `browser_totp`), `agent_browser_*`, `browser_use_*` et `opencode_*`. Ils tournent dans EYAS sous le même portail de sécurité, les mêmes approbations, autorisations et portée d'outils que pour les modèles d'API. Pour Grok et Kimi, la liaison par tour stocke la portée d'outils côté serveur : `tools/list` montre exactement les outils autorisés, `tools/call` refuse tout autre — avant que le portail de sécurité soit consulté, donc sans jamais créer d'approbation —, et le refus apparaît sur la ligne d'outil du tour comme **Refusé**. La liste d'outils du prompt système d'un modèle CLI ne nomme pas les outils EYAS que remplacent les outils propres autorisés de la CLI.

Résultat : les CLI de code et le chemin web de l'agent voient **une surface d'outils cohérente** au lieu d'inventer des intégrations parallèles. Sur Claude Code, chaque appel relayé porte la conversation, son projet, la réponse (le tour) et l'exécution : la consultation de la mémoire est donc de **3 appels par réponse** comme chez les autres fournisseurs, les résultats de mémoire restent verrouillés sur le projet de la conversation, son type et la mémoire globale, et les exécutions d'outils sont attribuées à l'exécution supervisée. Une requête faite hors d'une conversation n'est pas attribuée à un identifiant de conversation vide. Les agents Grok et Kimi atteignent `memory_search` / `memory_expand`, le tableau, les documents, la recherche et le reste des outils EYAS. L'assistant dit aussi au modèle que la mémoire d'EYAS est la seule mémoire et que `memory_search` / `memory_expand` viennent de ce serveur.

<h3 id="how-the-bridge-is-secured">Comment le pont est sécurisé</h3>

- Chaque tour de réponse reçoit son propre secret aléatoire (192 bits).
- EYAS enregistre côté serveur à quelle conversation, quel agent, projet, tour et exécution appartient le secret, si le tour est suivi (un chat interactif ou une conversation de canal) ou autonome (une exécution en arrière-plan ; un tour non marqué comme suivi compte comme autonome), et la liste des appels déjà exécutés d'une exécution reprise. Le processus assistant ne fait que présenter le secret ; rien de ce qu'il envoie ne peut faire agir un appel d'outil pour une autre conversation, un autre projet ou un autre utilisateur.
- Le secret est révoqué dès la fin du tour (terminé, échoué, arrêté ou abandonné) et expire 2 heures après sa dernière utilisation : un tour long et actif garde donc ses outils EYAS.
- Une requête visiblement passée par un proxy depuis une adresse non locale est refusée, même avec un secret valide.
- Les appels relayés passent par la même décision que les appels d'outils de Claude Code et que la boucle d'outils propre des fournisseurs d'API : d'abord la vérification de la liste d'outils (un outil hors de la liste de l'agent est refusé comme **Refusé** avant le portail, donc il ne met jamais d'approbation en file), puis le [portail de sécurité](/docs/fr/admin/security-privacy/) d'EYAS et, pour les tours autonomes, l'échelle d'autonomie ; les contrôles d'autorisation tournent en tant qu'agent. Dans un chat suivi ou une conversation de canal, un appel que le portail autorise s'exécute — un outil marqué comme demandant une approbation n'attend plus dans la file du seul fait que le modèle est Grok ou Kimi —, et un appel que le portail escalade affiche une carte d'approbation sans mettre le chat en pause. Dans une exécution autonome, un appel en **Avis** ou **Approuver** attend une approbation, et un appel escaladé attend toujours une personne, même en **Auto** (avant, il s'exécutait sans demander sur Grok et Kimi). Sans portail de sécurité en marche, chaque appel relayé est refusé. Le pont connaît côté serveur les dossiers du tour — tous les dossiers de la conversation, pas seulement le premier —, donc les outils de fichiers EYAS y fonctionnent, et une requête ne peut jamais nommer ses propres dossiers.
- Quand un outil EYAS relayé est refusé ou attend une approbation, le résultat revient sur la même ligne d'outil de la conversation, avec l'entrée de l'approbation dans la file des Approbations. Dans une exécution autonome supervisée, une telle approbation met l'exécution en pause (**En attente d'approbation**) une fois le tour de la CLI terminé, comme une approbation pour les outils propres de la CLI ; une fois approuvée, l'exécution reprend et exactement l'appel approuvé est autorisé une fois.
- Une exécution reprise ou relancée qui répète un appel d'outil EYAS que l'exécution d'origine a déjà terminé est refusée avant de s'exécuter, et la ligne affiche **Ignoré** — *already executed on the original run — duplicate side effect prevented*. Le même outil avec d'autres arguments s'exécute toujours. Sur Grok, la ligne d'outil d'un outil EYAS enregistre les arguments que l'outil a reçus (le `tool_input` de `use_tool`), pas l'enveloppe de Grok, si bien que l'exécution reprise reconnaît la répétition. Prouvé sur le Grok CLI installé par la vérification de publication ; la façon dont un vrai binaire Kimi rapporte ces appels n'a pas encore été vérifiée sur un hôte.
- Les résultats des outils de mémoire (`memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory`), y compris leurs textes d'erreur, sont masqués par la politique de confidentialité avant que la CLI les reçoive, exactement comme la mémoire du prompt : le fournisseur de la CLI compte toujours comme distant, et rien de ce qu'envoie l'assistant ne peut y changer. Le même masquage s'applique aux outils EYAS in-process de Claude Code. Si l'analyse échoue, le résultat est retenu (*Error: memory tool result withheld (privacy scan failed)*). Les résultats des autres outils passent inchangés. Voir [Où s'applique le masquage](/docs/fr/admin/security-privacy/#where-masking-applies).
- Exactement deux chemins internes contournent la connexion web : `/api/v1/internal/cli-mcp/tools/list` et `/api/v1/internal/cli-mcp/tools/call`. Tout autre chemin interne exige toujours une connexion.

L'assistant tourne avec le même runtime qu'EYAS (Bun), depuis son propre emplacement d'installation, il fonctionne donc aussi dans les images Docker ; `EYAS_INSTALL_ROOT` ne sert pas à le trouver.

<h3 id="boot-self-test">Auto-test au démarrage</h3>

Au démarrage, EYAS teste le pont à travers toute la pile de requêtes, de la même façon que l'assistant l'appellera. Le succès est journalisé comme *CLI tool bridge self-test passed*. L'échec est un avertissement — *CLI tool bridge self-test failed — Grok/Kimi turns cannot reach EYAS tools (memory, board, …)* — avec la raison jointe ; le démarrage continue, mais Grok et Kimi tournent alors sans outils EYAS. Sur une installation neuve, le test est reporté jusqu'à la fin de l'assistant de configuration (journal info) et s'exécute au démarrage suivant.

| Raison dans l'avertissement | Que faire |
|-----------------------------|-----------|
| `tools/list returned HTTP 401 … Authentication required` | Il manque à la version en cours l'exemption du pont. Mettez à jour ou recompilez, puis redémarrez. |
| `stdio MCP server not found at …` | Il manque `dist/stdio-mcp-server.js` à la compilation. Recompilez avec `bun run build` (les images Docker construites depuis cette version l'incluent), puis redémarrez. |
| `HTTP 404` | Le module Tools est désactivé : il n'y a aucun outil EYAS à proposer. |

<h3 id="outside-mcp-clients">Clients MCP externes</h3>

Les clients du propre serveur MCP d'EYAS (`/api/v1/mcp/tools/call`) n'ont pas de conversation EYAS. Leurs appels d'outils de mémoire ne lisent que la mémoire globale, avec une limite de 3 appels par tranche de 90 secondes. Voir [Mémoire — Chercher plus loin](/docs/fr/knowledge/memory/#looking-further-memory_search-and-memory_expand).

- **Masqués.** Les résultats d'outils de mémoire envoyés à un client MCP externe sont masqués par la politique de confidentialité comme pour toute autre destination distante — un client externe peut faire tourner n'importe quel modèle, il compte donc toujours comme distant. Une analyse en échec retient le résultat.
- **Validés.** Un corps `tools/call` mal formé reçoit HTTP `400` avec une erreur JSON-RPC : `-32600` *Invalid Request* pour un corps qui n'est pas du JSON ou pas un objet, `-32602` *Invalid params* pour un nom manquant ou des `arguments` qui ne sont pas un objet. Un outil inconnu donne `404` avec `-32601`.

<h2 id="tool-names-per-host">Noms d'outils par hôte</h2>

Les outils EYAS ont un nom canonique (`memory_search`, `memory_expand`, …). Chaque hôte de modèle les liste différemment :

| Hôte | Comment le modèle appelle `memory_search` |
|------|-------------------------------------------|
| Fournisseurs d'API (Anthropic, OpenAI, Gemini, OpenRouter, Kimi API, Ollama, LM Studio, points de terminaison compatibles) | `memory_search` — EYAS exécute l'outil lui-même |
| Claude Code CLI | `mcp__eyas__memory_search` — les outils viennent du serveur MCP in-process d'EYAS nommé `eyas`, qui ne passe pas par le pont stdio et ne dépend donc pas de son auto-test au démarrage |
| Grok CLI | Les outils EYAS ne sont pas dans la liste d'outils propre à Grok. Le modèle en trouve un avec `search_tool`, puis appelle `use_tool` avec `tool_name` `eyas__memory_search` et ses arguments dans `tool_input`. Un simple `memory_search` dans Grok est l'outil de mémoire intégré de Grok, pas la mémoire d'EYAS : EYAS ne demande donc jamais à un modèle Grok d'appeler un `memory_search` nu. |
| Kimi Code CLI | `memory_search` sur le serveur MCP nommé `eyas`. Le nommage exact de Kimi n'est pas encore vérifié : EYAS nomme donc le serveur plutôt qu'un nom d'outil qualifié. |
| OpenCode (dans une tâche `opencode_run`) | `memory_search` — un outil du plugin de mémoire d'EYAS dans OpenCode, avec le nom, la description et les arguments d'EYAS. Le plugin envoie l'appel à EYAS, qui exécute le véritable outil pour la conversation de la tâche. Il ne propose que `memory_search` et `memory_expand`, rien qui écrive. |

Quand EYAS sait quel fournisseur exécute un tour, la liste d'outils du prompt système se termine par une ligne qui indique au modèle comment appeler les outils listés sur son hôte — sur Claude Code, que les outils EYAS viennent du serveur MCP d'EYAS et s'appellent `mcp__eyas__<name>`. Les indications de mémoire et la ligne *N notes de plus* nomment les outils de la même façon. Les modèles des fournisseurs d'API voient les noms simples. Il n'y a rien à configurer. Quand une conversation passe à un fournisseur qui nomme les outils autrement, le préfixe de prompt en cache change une fois (un défaut de cache ponctuel).

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [OpenCode](/docs/fr/automation/opencode/)
- [Médias](/docs/fr/ai/media/)
- [Configurer les agents](/docs/fr/agents/configure/)
- [Connexions](/docs/fr/admin/connections/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Importation de données](/docs/fr/admin/data-port/)
