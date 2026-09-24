---
title: Sécurité et confidentialité
description: Portail de sécurité, flux d’événements, journal d’audit et politique de confidentialité — avant et après les outils.
---

**À quoi ça sert.** Trois surfaces d’opérateur se trouvent derrière ce chapitre. Le **portail de sécurité** est la politique d’exécution qui autorise, refuse ou escalade un appel d’outil *avant* qu’il s’exécute. **Événements de sécurité** (`/security`) est le flux de ces décisions. **Audit** (`/audit`) est le journal immuable des actions (avec restauration optionnelle). **Confidentialité** (`/privacy`) est l’endroit où tu modifies et testes la politique de confidentialité : quelles données personnelles sont masquées quand du texte quitte EYAS vers un modèle distant, quels nouveaux messages sont refusés — et le même masque que la capture de mémoire durable applique *avant* l’écriture dans le coffre.

## Quand l'utiliser

- Un appel d’outil a été refusé et tu as besoin du point de contrôle, du risque et du motif.
- Tu veux confirmer que les outils navigateur ne peuvent pas atteindre des hôtes privés ou de métadonnées (SSRF).
- Tu vas activer l’autonomie et tu veux voir ce que le portail escaladera.
- Tu dois vérifier si des PII fuient dans les logs, les notes du coffre ou les prompts sortants.
- Tu veux savoir ce que reçoit un modèle distant quand un prompt contient une adresse e-mail, un IBAN ou un numéro fiscal.
- Un modèle s’est vu refuser un chemin avec *Memory outside EYAS …* ou *… is read and written only by EYAS*, et tu veux savoir pourquoi — ou voir quels emplacements sont interdits sur ce serveur.
- Tu veux savoir comment les outils IA en ligne de commande (Claude Code, Grok, Kimi, OpenCode) sont tenus à l’écart de la configuration propre de la machine, comment c’est prouvé, et si leur sandbox de fichiers du noyau est actif.
- Un message a été refusé avec *Message non envoyé — confidentialité*, ou tu veux changer quelles valeurs sont masquées ou refusées.
- Un modèle a tourné sans l’isolation d’EYAS et sa mémoire doit être cachée à tous les modèles (voir [Mettre en quarantaine la mémoire d’un fournisseur](#quarantine-a-providers-memory)).

## Déroulement typique

1. Ouvre **Sécurité** (`/security`). La carte **Mémoire hors d’EYAS** est en haut (propriétaires et admins). Filtre les événements par décision (**Autoriser / Refuser / Escalader**), risque et point de contrôle.
2. Ouvre **Audit** (`/audit`) pour savoir qui a fait quoi, le module, le résultat (**succès / erreur / refusé / rétabli**) et le coût. La restauration est une action avec confirmation quand elle est proposée.
3. Ouvre **Confidentialité** (`/privacy`) : lis les compteurs de trafic, ajuste la politique (action par type, motifs personnalisés, hôtes locaux) et **Enregistrer la politique**, puis **Tester l'analyseur PII** avec un texte d’exemple — *Tel que le reçoit un modèle distant* est ce que recevrait un modèle distant.
4. Combine avec [Autonomie](/docs/fr/agents/autonomy/) (approbations) et [Secrets](/docs/fr/admin/secrets/).
5. Pour le SSH vers d’autres machines, voir [Nœuds](/docs/fr/admin/nodes/) — les motifs destructeurs exigent un indicateur de forçage explicite.

## Fonctions

| Domaine | Route / signification |
|---------|-----------------------|
| **Portail de sécurité** | Politique d’exécution avant les outils dangereux |
| **Événements de sécurité** | Flux d’événements `/security`, avec la carte **Mémoire hors d’EYAS** |
| **Audit** | `/audit`, journal immuable des actions |
| **Confidentialité** | `/privacy` : compteurs de trafic, éditeur de la politique de confidentialité, testeur d’analyse |

### Protection SSRF du navigateur {#browser-ssrf-protection}

Les outils navigateur bloquent les requêtes vers des hôtes **privés / de métadonnées** (métadonnées cloud, loopback, RFC1918, etc.) pour réduire le risque de falsification de requêtes côté serveur. Préfère `browser_snapshot` (éléments interactifs numérotés) aux captures d’écran quand les agents n’ont besoin que de la structure. Les index ne valent plus après une navigation. Le profil headless appartient à EYAS (`data/browser/profile`) ; le profil Chrome quotidien est refusé (Chrome 136+ bloque CDP sur le profil Default). `browser_evaluate` s’exécute dans la page, pas dans Node. `browser_totp` est **jaune** : il lit une graine dans Secrets/Trousseau et ne renvoie qu’un code à courte durée de vie (à passer à `browser_fill`). Le JSON du cache d’actions stocke des locators, jamais des secrets ni des valeurs saisies. Les sidecars optionnels [Browser Use](/docs/fr/automation/browser-use/) (recommandé : agent-browser sous `data/browser/agent-browser/profile` ; ancienne CLI Python) ne désactivent jamais le sandbox de Chromium automatiquement, n’appellent jamais `chat` / AI Gateway et ne s’attachent jamais au profil Chrome quotidien.

### Git en lecture seule sans clic {#read-only-git-without-a-click}

`git_status` et `git_diff` sont verts. Quand le modèle envoie à la place `run_command` / `Bash` dont l’argv est sans ambiguïté `git status` ou `git diff` (sans métacaractère, sans `-C` / `--git-dir` / `--no-index`, sans chemin absolu), le portail réaffecte l’appel à ces outils et **l’autorise** — sans ligne d’approbation. `git commit`, `git add`, `ls` et toute commande avec métacaractères restent rouges ou sont refusés. Voir [Outils](/docs/fr/automation/tools/).

### Juge de sécurité {#security-judge}

Les appels d’outils jaunes et rouges passent un contrôle IA avant de s’exécuter. Ce contrôle est un court appel isolé sur le modèle d’arrière-plan d’EYAS — sans outils, sans historique de conversation, jamais une session CLI qui charge la mémoire ou la config propres de la CLI. Il utilise le niveau de routage **Heartbeat**, puis **Quick**, puis le défaut de l’install, puis les autres fournisseurs éligibles (tout fournisseur API, Claude Code, Grok CLI une fois réussie sa vérification d’isolation au chargement du fournisseur (démarrage, rechargement, réactivation) ou au démarrage de session d’un tour, et Kimi Code CLI une fois qu’une session a démarré sur cet hôte, ce qui inclut la découverte des modèles au chargement tant qu’il est connecté pour EYAS). Un second modèle n’est essayé qu’après un échec réseau, un délai dépassé, une surcharge ou une limite de débit.

Quand aucun modèle n’est éligible (par exemple une install Grok seul dont l’isolation n’est pas encore vérifiée), que le budget modèle est arrêté ou que toutes les tentatives échouent, l’appel est **escaladé pour ton approbation** (une demande d’approbation dans la file) — jamais autorisé. Avant, un contrôle IA en échec bloquait l’appel d’emblée. Si la catégorie d’autonomie d’un agent est au niveau 3 (**Auto**), EYAS exécute l’appel sans demander, comme il le faisait déjà quand aucun fournisseur IA n’était configuré. Une réponse que le contrôle ne peut pas lire refuse toujours l’appel. Sur une install où Claude Code est le seul modèle, chaque contrôle IA démarre un court processus Claude Code isolé.

### Mémoire hors d’EYAS {#memory-outside-eyas}

Le portail de sécurité refuse la mémoire hors d’EYAS — **en lecture comme en écriture** — pour tous les modèles et chaque appel d’outil qu’il vérifie. Refusés :

- la mémoire et l’état des autres assistants : Claude Code (`~/.claude`, `~/.claude.json`), Grok, Codex, Gemini, Kimi, Cursor, Windsurf, les dossiers d’OpenCode, les dossiers de skills d’agents partagés, Copilot, les mêmes dossiers cachés dans le home des autres utilisateurs, tout dossier `ai-memory` et tout dossier de mémoire sous un dossier caché d’outil ;
- les coffres Obsidian (trouvés par leur dossier `.obsidian` ou par la liste de coffres d’Obsidian) et les réglages de l’app Obsidian ;
- chaque chemin listé dans `security.foreignMemoryPaths` (lu au démarrage ; les entrées qui ne sont pas des chemins absolus sont ignorées avec un avertissement dans le log) ;
- le dossier de données propre d’EYAS — coffre, base (aussi quand `database.path` pointe ailleurs), clés, profil du navigateur et dossiers de connexion CLI propres à EYAS (`data/cli-homes`) ;
- l’espace de travail d’une autre conversation, dès que les dossiers de travail de l’appel sont connus.

Toujours permis : l’espace de travail et les dossiers de la conversation elle-même, les projets Studio (`data/studio`), les téléchargements du navigateur (`data/browser/downloads`), et les fichiers de projet ordinaires comme `CLAUDE.md`, `AGENTS.md`, `.claude/settings.json`, `.claude/agents` et `docs/MEMORY.md`. Un fichier dont le texte ne fait que *mentionner* ces chemins ne pose pas de problème — le portail juge le chemin, pas le contenu —, et le motif de recherche de Grep n’est jamais traité comme un chemin.

**Où cela s’applique :** les outils EYAS exécutés par la boucle d’agent propre d’EYAS (fournisseurs API) ; les outils EYAS que Grok et Kimi appellent via le pont d’outils (le pont connaît côté serveur les dossiers du tour, et une requête ne peut jamais nommer les siens) ; chaque appel d’outil pour lequel Claude Code demande une permission ; les outils intégrés propres de Claude Code (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, WebFetch, …), qui passent une vérification **avant de s’exécuter** — y compris les lectures que Claude Code s’autoriserait sinon tout seul dans son dossier de travail ; chaque demande de permission de Grok/Kimi (Grok demande pour tous ses outils natifs, lectures comprises) ; et chaque fichier que Grok ou Kimi lit ou écrit via EYAS. Quels dossiers comptent comme ceux de la conversation, c’est EYAS qui le décide — ses Dossiers qui passent encore la validation plus le dossier dans lequel la CLI a été démarrée —, jamais l’endroit où la CLI dit se trouver. Les tâches OpenCode sans interface sont contrôlées de la même façon, avec les dossiers de la tâche. Grok, Kimi et OpenCode tournent dans leur propre home appartenant à EYAS, vers lequel pointent `~` et `$HOME` : un chemin écrit avec eux est jugé à la fois comme ce home et comme le tien, si bien que `~/../../vault` ou `$HOME/../../sqlite` n’atteint ni les données d’EYAS ni le dossier de connexion d’une autre CLI.

**Un dossier est jugé sur ce qu’il contient.** Une CLI comme Claude Code lit et cherche dans son dossier de travail sans rien demander — la vérification de publication a confirmé sur le vrai binaire que ces lectures n’atteignent jamais l’étape d’approbation. Un Dossier de conversation, de projet ou de type de projet est donc refusé non seulement quand il se trouve dans l’un des emplacements ci-dessus, mais aussi quand il en **contient** un : le home propre d’EYAS, son dossier de données, sa base ou son dossier des espaces de travail (par exemple le checkout d’EYAS qui contient `data/`), le stockage d’un autre outil IA ou un dossier de connexion CLI d’EYAS, un coffre de notes, un dossier `ai-memory` ou une entrée de `security.foreignMemoryPaths` (par exemple `~/Documents` contenant un coffre). Les dossiers enregistrés plus tôt et désormais refusés sont écartés de chaque exécution, avec un avis dans le chat. Voir [Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders). Sur Claude Code, la vérification de la politique mémoire refuse aussi les lectures que Claude Code s’autorise tout seul dans son dossier de travail — un coffre ou les données d’EYAS atteints par un chemin absolu ou relatif, un lien symbolique, Grep, Glob, LS ou un `cat` dans le shell ; cela a été prouvé sur le vrai binaire.

**Les recherches sont jugées sur ce qu’elles peuvent atteindre.** Une recherche faite avec les propres outils d’une CLI est refusée non seulement quand son dossier est protégé, mais aussi quand le dossier qu’elle parcourt **contient** un emplacement protégé et que ses globs d’inclusion peuvent l’atteindre : on ne peut pas demander à la CLI d’écarter cet emplacement, donc l’appel est refusé avant de s’exécuter. Cela couvre Grep, Glob et LS de Claude Code ; grep et list_dir de Grok ; grep, glob et list d’OpenCode ; et les commandes shell passées par le Bash de Claude Code, le shell de Grok et le `run_command` d’EYAS qui cherchent récursivement — `grep -r`/`-R`, `rg`, `ag`, `ack`, `find`, `fd`, `tree`, `du`, `ls -R`, `cp`/`rsync`/`scp`/`zip`/`tar`/`ditto` récursifs, `locate`/`mdfind`, `git grep --no-index` — ou qui utilisent des mots glob comme `cat ~/.*/projects/*/memory/*.md`. Les emplacements protégés sont ceux listés plus haut.

- **Refusé**, par exemple : Grep dans `~` avec le glob `**/memory/*.md` ; Glob dans `~` pour `**/MEMORY.md` ; `grep -r token ~` ; Grep dans `~/Documents` quand un coffre s’y trouve ; un Grep dont le chemin est le checkout d’EYAS ou un dossier au-dessus, comme `grep -rn x ~/GitHub` quand le checkout s’y trouve (le checkout contient `data/`).
- **Toujours permis :** une recherche dont le dossier ou le glob ne peut pas atteindre l’emplacement protégé — par exemple le dossier `src` du checkout comme chemin, ou le glob `src/**/*.ts` avec le checkout comme chemin — et toute recherche dans un dossier de projet ordinaire. Écrire un fichier par un here-document (`cat > a.ts <<'EOF'` … `EOF`) n’est pas une recherche : ses lignes sont des données, jamais des mots glob ni des commandes. Les globs d’exclusion (`!…`) ne restreignent pas une recherche. Un glob sans barre oblique (`*.md`) correspond à n’importe quelle profondeur, comme dans ripgrep, et atteint donc chaque sous-dossier ; les mots glob du shell sont ancrés là où ils sont écrits.
- **Le même refus.** C’est le même refus dur et déterministe que tout autre refus de chemin mémoire : pas de juge IA, pas d’approbation, jamais ouvert par une autorisation, non compté dans le verrouillage après 3 refus, et en vigueur même avec le portail désactivé. Il écrit une ligne **Refuser** sous Événements de sécurité (point de contrôle `deterministic`) et compte dans le nombre de refus de la [carte Mémoire hors d’EYAS](#memory-outside-eyas-card).
- **Comment les emplacements sont trouvés.** Les emplacements qu’EYAS connaît par leur nom sont toujours vérifiés : les magasins des autres outils, les coffres Obsidian enregistrés, `security.foreignMemoryPaths`, le dossier de données et la base d’EYAS, les homes CLI et les espaces de travail des autres conversations. Les coffres connus seulement par leur dossier `.obsidian`, les dossiers `ai-memory`, les dossiers memory sous les dossiers cachés d’outils et les liens symboliques vers des emplacements protégés sont trouvés par un parcours borné du dossier cherché : les 2 000 premiers dossiers, sur 8 niveaux, jamais dans `node_modules` ni `.git`/`.hg`/`.svn`. Au-delà de cette limite, seuls les emplacements nommés sont vérifiés. La lecture des commandes shell reste au mieux : les variables ne sont pas suivies ; `cd`, `eval`, `sh -c`, un shell qui lit son script dans un here-document, les mots réservés (`if`, `then`, `do`, `{`, `!`), les redirections comme `2>/dev/null` et les alternatives entre accolades comme `~/{.,}` le sont. Une recherche lancée par `xargs` ou `parallel` reçoit ses dossiers d’une entrée que la ligne de commande ne montre pas : elle compte donc comme une recherche de `/`.
- **Les `grep` et `glob` propres d’EYAS** ne sont jamais refusés pour un tel dossier : ils écartent les dossiers protégés, et désormais aussi les fichiers protégés — une base conservée dans le dossier cherché, ou un fichier listé dans `security.foreignMemoryPaths`, même quand il est nommé directement.
- **Kimi Code CLI** (d’après le source de kimi-cli 1.52.0 ; non vérifié sur un hôte) : les propres Grep et Glob de Kimi ne demandent jamais rien à EYAS, donc EYAS ne peut pas refuser une recherche Kimi qui part au-dessus d’un emplacement protégé. Le Glob de Kimi reste dans son dossier de travail, mais son Grep accepte n’importe quel dossier, et Kimi n’a pas de sandbox noyau. Les commandes shell de Kimi demandent bien, mais la demande ne porte pas la commande sous une forme que la vérification de chemin sait lire : c’est donc le juge IA ou une personne qui décide.

**Comment il refuse :** aussitôt et de façon déterministe. Il n’y a pas de juge IA, pas de demande d’approbation, et aucune approbation ni autorisation ne peut l’ouvrir. Le refus ne compte pas dans le verrouillage après 3 refus : un modèle qui retente un chemin interdit ne bloque donc pas les autres outils pendant 10 minutes. Cela tient aussi quand le portail de sécurité est désactivé. Chaque refus donne une ligne sous **Événements de sécurité** — décision **Refuser**, point de contrôle `deterministic`, et un motif. La vérification échoue en fermé : si elle ne peut pas répondre, l’appel est refusé. Seul un appel d’arrière-plan ponctuel sans aucun outil s’en passe.

**Ce qu’on dit au modèle :**

- *Memory outside EYAS (&lt;store&gt;) — use memory_search / memory_expand from EYAS*
- *EYAS data directory (&lt;part&gt;) is read and written only by EYAS*
- *EYAS-owned CLI home (cli-homes) is read and written only by EYAS*
- *Not this conversation's workspace (…) — work in this conversation's folders*
- *Search too broad [memory-path:search-scope:&lt;target&gt;]: the folder searched contains &lt;what&gt;, and this tool cannot leave it out — search a narrower folder that does not contain it* — pour la mémoire d’un autre outil, il ajoute *; for memory use memory_search / memory_expand from EYAS*. La cible est `foreign-memory`, `eyas-data`, `provider-home` ou `other-workspace`. La ligne d’outil **Refusé** du chat en fait une ligne traduite, par exemple *Recherche trop large : le dossier contient aussi la mémoire d'un autre outil, que seul EYAS peut lire. Le modèle a été invité à chercher dans un dossier plus restreint.* — ou les données propres d’EYAS, les connexions CLI conservées par EYAS, ou l’espace de travail d’une autre conversation.

Grok CLI ne transmet pas le motif à son modèle : quand EYAS refuse un des appels d’outils de Grok, Grok termine cette réponse, et le chat affiche la ligne d’outil refusée et plus rien ensuite. Redemande sans cette étape — après un refus *Recherche trop large*, avec un dossier plus restreint. Claude Code continue et reçoit le motif, et peut donc relancer de lui-même une recherche sur un dossier plus restreint. Voir [Fournisseurs — Grok CLI et Kimi Code CLI](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli).

**La couche noyau.** Les commandes shell peuvent atteindre un chemin que le texte de la commande ne montre pas, et certains outils des CLI ne demandent jamais rien à EYAS. Pour ceux-là, le shell de Claude Code et les propres outils de Grok CLI tournent dans le sandbox de fichiers du système d’exploitation (macOS Seatbelt, Linux bubblewrap), qui bloque les mêmes emplacements au niveau du noyau : la mémoire des autres outils, les données privées d’EYAS et les espaces de travail des autres conversations. Avec `security.cliSandbox: auto` (le défaut), une CLI tourne sans lui là où aucun n’est disponible et le chat le signale une fois ; avec `required`, ces tours sont refusés. En `auto`, une commande Claude Code qui demande à s’exécuter hors du sandbox attend toujours l’approbation d’une personne — jamais le juge IA, jamais l’échelle d’autonomie. Kimi Code CLI n’a pas de sandbox noyau : ses propres outils read, grep et glob ne sont donc toujours vérifiés que là où EYAS les voit. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox). L’[import de données](/docs/fr/admin/data-port/) n’est pas concerné, parce qu’il lit lui-même les magasins des autres outils et pas via un outil de modèle.

**Migration.** Les agents qui lisaient directement `~/.claude/CLAUDE.md`, la mémoire de `~/.grok`, des notes de coffre ou des fichiers sous `data/` sont désormais refusés (les Événements de sécurité le montrent). Fais entrer ce savoir dans EYAS une fois avec l’import de données. Les agents ou habitudes qui cherchaient dans tout le home ou dans un dossier parent avec les propres outils d’une CLI sont refusés aussi : dirige-les vers un sous-dossier, ou utilise les `grep`/`glob` d’EYAS, qui écartent les emplacements protégés. Un Dossier qui contient un emplacement protégé — le checkout d’EYAS, un `~/Documents` contenant un coffre — n’est plus accepté : choisis un dossier plus restreint, comme le dossier du projet dans `~/Documents` ou un clone séparé du dépôt. Les serveurs MCP qui conservent une mémoire hors d’EYAS sont bloqués aussi — voir [MCP](/docs/fr/ai/mcp/#memory-store-servers-are-blocked).

### La carte Mémoire hors d’EYAS {#memory-outside-eyas-card}

La page **Événements de sécurité** (`/security`) s’ouvre sur une carte **Mémoire hors d’EYAS**. Seuls les propriétaires et les admins la voient, parce qu’elle montre des chemins absolus du serveur ; les autres rôles reçoivent une erreur de chargement et aucun chemin. Elle affiche :

- **Deux compteurs pour les dernières 24 heures.** *Refus de la politique mémoire* compte les appels d’outils que la politique mémoire a refusés, sur n’importe quel canal — lire ou écrire la mémoire d’un autre outil, un coffre Obsidian, le dossier de données propre d’EYAS, sa base ou les connexions des CLI, ou l’espace de travail d’une autre conversation, ainsi que les recherches refusées comme trop larges parce que leur dossier contient l’un d’eux. *Commandes ayant demandé à sortir du sandbox* compte les commandes shell qui ont demandé à s’exécuter hors du sandbox noyau et ont été envoyées à un humain pour approbation.
- **Mémoire d’autres outils sur ce serveur** — les magasins connus d’autres outils IA et applis de notes qui existent ici (par exemple `~/.claude`, `~/.grok`, `~/.codex`, les dossiers d’OpenCode, les réglages de l’app Obsidian), avec leurs chemins, et combien d’autres emplacements connus sont protégés dès qu’ils apparaissent. Une phrase explique ce qui est protégé en plus, où que ce soit : tout dossier contenant un dossier `.obsidian` (un coffre Obsidian), les dossiers nommés `ai-memory`, et les dossiers memory dans `.claude`, `.grok`, `.codex` et autres dossiers d’outils similaires.
- **Coffres Obsidian trouvés** — les coffres de la liste de coffres d’Obsidian, plus ceux qu’EYAS a reconnus à leur dossier `.obsidian` en vérifiant des appels d’outils. Un coffre qui n’est pas listé reste protégé par son dossier `.obsidian`.
- **Vos ajouts (security.foreignMemoryPaths)** — les chemins supplémentaires de la configuration. Les chemins qui n’existent pas encore sont marqués *pas encore sur ce serveur* ; les entrées qui ne sont pas des chemins absolus sont marquées *ignoré*. Pour protéger un autre dossier ou fichier, ajoute son chemin absolu à `security.foreignMemoryPaths` dans le fichier de configuration et redémarre EYAS (la liste est lue au démarrage).
- **Données propres d’EYAS** — le dossier de données, la base de données et les connexions des CLI (les homes CLI propres à EYAS). Seul EYAS les lit et les écrit ; les modèles peuvent utiliser l’espace de travail de leur conversation, les projets Studio et les téléchargements du navigateur.
- **Espaces de travail des conversations** — la racine des espaces de travail. Le modèle de chaque conversation n’y voit que son propre espace de travail.
- **Sandbox de fichiers du noyau des fournisseurs CLI** — le mode `security.cliSandbox` (`auto` ou `required`) et, pour chaque fournisseur CLI activé (Claude Code, Grok CLI, Kimi Code CLI), si ses propres outils tournent dans le sandbox noyau : *actif*, *indisponible* ou *non pris en charge*, avec la raison (bubblewrap pas installé, socat manquant — nécessaire à Claude Code —, espaces de noms utilisateur désactivés, système d’exploitation non pris en charge, ou la CLI n’en propose aucun). Avec `required` et sans sandbox, la carte indique que les tours avec outils sur cette CLI sont refusés. Avec *indisponible* ou *non pris en charge* en `auto`, les propres outils de la CLI tournent sans le sandbox et EYAS vérifie toujours chaque appel d’outil qu’il voit. Avec `auto` et un sandbox Claude Code actif, une commande Claude Code qui demande à s’exécuter hors du sandbox attend toujours l’approbation d’une personne.

**API.** `GET /api/v1/security/memory-policy` (lecture `SecurityEvent`). Il n’y a ni nouveau réglage ni nouvelle variable d’environnement.

### Les outils IA en ligne de commande tournent isolés {#ai-command-line-tools-run-isolated}

- **Claude Code** tourne toujours isolé : aucun `settings.json`, `CLAUDE.md`, skill, serveur MCP ni auto-mémoire de l’hôte, aucune transcription sur l’hôte, un environnement en liste blanche, et une vérification au démarrage qui arrête une exécution si autre chose a été chargé. Voir [Fournisseurs — Isolation de Claude Code](/docs/fr/ai/providers/#claude-code-isolation).
- **Grok CLI et Kimi Code CLI** tournent dans des homes propres à EYAS (`data/cli-homes/…`, qui contiennent leurs connexions pour EYAS), demandent à EYAS avant leurs outils natifs, et ne tournent qu’après qu’EYAS a vérifié qu’elles sont isolées — un tour qui échoue à la vérification s’arrête et n’est jamais confié à un autre modèle. Voir [Fournisseurs — Grok CLI et Kimi Code CLI](/docs/fr/ai/providers/#grok-cli-and-kimi-code-cli).
- **OpenCode**, le sidecar optionnel, tourne dans un dossier propre à EYAS (`cli-homes/opencode`, qui contient sa connexion) et ne charge aucune instruction d’assistant, skill ni config de projet de l’hôte. Les tâches OpenCode headless demandent au portail de sécurité d’EYAS avant chaque appel d’outil. OpenCode ne lit la mémoire EYAS qu’avec les outils en lecture seule `memory_search` / `memory_expand` ; il n’a aucun outil qui écrit la mémoire. Chaque processus OpenCode qu’EYAS démarre reçoit sa propre clé sur le descripteur de fichier 3 — jamais dans un environnement, une liste d’arguments ou un fichier —, et la clé meurt avec ce processus. La clé elle-même ne quitte jamais OpenCode : chaque appel mémoire porte une preuve à usage unique pour la seule session OpenCode dans laquelle l’outil tourne, si bien qu’une commande lancée par le modèle, ou un autre processus, ne peut pas lire la mémoire d’une autre session. Limites qui restent : OpenCode ne lit son mot de passe de serveur que dans son environnement, donc un processus du même utilisateur système capable de lire l’environnement d’un autre processus peut piloter les sessions de ce serveur OpenCode via l’API propre d’OpenCode ; OpenCode n’a pas de sandbox noyau ; et un processus autorisé à lire la mémoire d’un autre processus peut atteindre la clé. Une URL d’attache vers un serveur OpenCode externe n’est pas isolée et n’a aucun accès à la mémoire EYAS. Voir [OpenCode](/docs/fr/automation/opencode/#eyas-memory-inside-opencode).
- **Sandbox de fichiers du noyau.** Les commandes shell de Claude Code et les propres outils de Grok CLI tournent dans le sandbox de fichiers du système d’exploitation là où il est disponible (`security.cliSandbox`) ; Kimi Code CLI n’en a pas. Voir [Fournisseurs — Sandbox de fichiers du noyau](/docs/fr/ai/providers/#kernel-file-sandbox).

### Comment l’isolation est prouvée {#how-isolation-is-proven}

Chaque exécution d’une CLI est vérifiée à son démarrage (voir plus haut). En plus, chaque version de CLI prise en charge par EYAS est prouvée avant sa sortie par une **vérification de publication**, `bun run test:live-cli`, que lancent les développeurs et les responsables des publications. Elle démarre les vrais Claude Code et Grok CLI (et Kimi Code CLI là où il est installé) via les fournisseurs propres d’EYAS, dans un home jetable rempli de pièges : des réglages d’hôte qui autorisent tout, des hooks et des serveurs MCP qui laisseraient une trace s’ils s’exécutaient, `CLAUDE.md`, `AGENTS.md`, des skills, un coffre de style Obsidian et un dossier de projet avec sa propre config. La partie gratuite envoie chaque requête de modèle à un faux modèle sur la machine locale : elle n’a besoin d’aucun compte et ne consomme aucun jeton. La partie payante exécute de vrais tours de modèle avec la connexion du propriétaire et est approuvée à chaque exécution.

La vérification s’assure que :

- aucune config d’hôte ou de projet, aucun fichier d’instructions, hook ou serveur MCP n’est chargé ;
- chaque fichier que Grok lit est demandé via EYAS, et le coffre reste dehors ;
- la politique mémoire d’EYAS refuse le coffre et le dossier de données propre d’EYAS ;
- le sandbox de fichiers du système d’exploitation arrête une lecture cachée du coffre dans le shell de Claude Code ;
- une lecture normale de l’espace de travail fonctionne toujours ;
- aucun magasin de sessions ne reste dans les homes CLI d’EYAS ;
- Grok et Kimi ne changent rien dans le home de l’hôte ;
- Claude Code n’écrit sur l’hôte qu’une courte liste versionnée de fichiers de gestion, jamais de contenu de conversation ;
- le dossier temporaire de Claude Code, où va la sortie des commandes shell d’arrière-plan, est le dossier propre à l’exécution dans EYAS et disparaît avec elle — rien ne reste dans le `/tmp/claude-<uid>` de l’hôte.

Cette liste : `~/.claude.json` limité aux clés de démarrage et de gestion (premier démarrage, migrations, cache de feature flags, compteurs d’utilisation des plugins), plus ses copies de sauvegarde et son dossier de verrou ; des dossiers de session et de marqueurs vides sous `~/.claude` et `~/.config/anthropic` ; des instantanés du shell sans contenu de conversation ; le propre log de npm pour `npm root --global` dans `~/.npm/_logs` ; le cache de Bun quand le `node` du PATH est Bun ; et, sur les hôtes sans trousseau, le fichier de rafraîchissement de la connexion. Jamais une transcription, une liste de tâches, un historique de fichiers, un plan ou un historique de prompts.

**Test mémoire.** Sur Claude Code et Grok CLI, la vérification fait aussi passer la politique mémoire par le vrai portail de sécurité. Un dossier inscrit seulement dans `security.foreignMemoryPaths` est refusé à la lecture de fichier propre du modèle comme à un `cat` dans le shell, et une écriture dans le coffre d’EYAS est refusée. Chaque refus donne exactement une ligne **Refuser** dans les Événements de sécurité, venant de la politique mémoire (point de contrôle `deterministic`, jamais un verrouillage par limite de débit), et une ligne d’outil refusée. Une lecture de l’espace de travail après ces refus fonctionne toujours, et rien du dossier refusé n’atteint le modèle. Deux autres cas gratuits couvrent les recherches : Grep, Glob et `grep -r` de Claude Code, ainsi que grep et list_dir de Grok, lancés à la racine du home rempli de pièges, sont chacun refusés par la politique mémoire via le vrai portail — audités, avec une ligne d’outil refusée —, tandis qu’une recherche dans le dossier du projet fonctionne toujours. Un troisième montre que Claude Code lit un fichier de son dossier de travail sans passer par la vérification de permission d’EYAS, et que la vérification de la politique mémoire refuse une telle lecture quand elle tombe dans un coffre.

**Versions prouvées :** Claude Code 2.1.281 et Grok CLI 1.0.41, partie gratuite seulement. Kimi Code CLI n’est pas encore prouvé et n’a pas de test mémoire. Deux constats de la vérification sont intégrés aux vérifications de démarrage :

- Claude Code 2.1.281 annonce deux plugins compilés dans le binaire, `agents-md` et `telemetry`. Ils ne sont acceptés que sous la forme `<nom>@builtin`, parce que la vérification a prouvé qu’ils sont inoffensifs sous l’isolation d’EYAS : aucun `AGENTS.md` du dossier de travail ou d’un sous-dossier n’atteint le modèle. Tout autre plugin, y compris un nouveau plugin intégré d’une version ultérieure de Claude Code, arrête toujours l’exécution.
- Grok CLI 1.0.41 écrit un cache de réglages gérés par l’éditeur (`managed_config.toml`) dans son home EYAS, vide pour un compte normal. Un cache vide est accepté ; un cache qui contient un réglage quelconque arrête toujours le tour.

**`eyas doctor`** affiche une ligne par fournisseur CLI : *CLI isolation (Claude Code)*, *CLI isolation (Grok CLI)* et *CLI isolation (Kimi Code CLI)*. Chacune nomme le binaire qu’EYAS exécute — comment il a été trouvé (`EYAS_CLAUDE_CODE_BIN` / `EYAS_GROK_BIN` / `EYAS_KIMI_BIN`, dans le PATH ou fourni avec le SDK), son chemin et sa version — et si la vérification de publication a prouvé cette version. Une autre version, un binaire qui n’indique pas sa version ou une CLI jamais prouvée donne un avertissement, pas un arrêt : EYAS vérifie toujours chaque session au démarrage. Une CLI non installée ne pose pas de problème ; un `EYAS_*_BIN` invalide est un échec. Pour Grok et Kimi, la ligne vérifie aussi leur home EYAS, `<dossier de données>/cli-homes/<fournisseur>` : pas encore créé ne pose pas de problème ; un lien symbolique ou autre chose qu’un dossier est un échec (EYAS refuse de lancer la CLI ; supprime-le, la prochaine exécution le recrée) ; un dossier lisible par d’autres utilisateurs donne un avertissement, car il contient la connexion de la CLI (`chmod 700 <dossier>`) ; un fichier qu’EYAS y gère et qui a changé depuis qu’EYAS l’a écrit donne un avertissement — EYAS réécrit ces fichiers avant la prochaine exécution, donc un changement entre deux exécutions signifie que quelque chose d’autre modifie ce dossier. Doctor ne fait que lire : il exécute seulement `--version`. Voir [CLI](/docs/fr/deploy/cli/).

### Mettre en quarantaine la mémoire d’un fournisseur {#quarantine-a-providers-memory}

Si un modèle — typiquement une CLI comme Grok CLI, Kimi CLI ou Claude Code — a tourné sans l’isolation d’EYAS, il a pu répondre à partir d’une mémoire hors d’EYAS, et ses réponses ont été enregistrées dans la mémoire EYAS comme tout autre tour. Le propriétaire peut cacher à tous les modèles ce qu’un fournisseur a écrit — ses réponses et la sortie de ses outils, les faits et résumés qui en dérivent, et les notes de capture de ses conversations — et lever cette quarantaine plus tard. Rien n’est supprimé, et les propres messages du propriétaire ne sont jamais touchés. La carte se trouve sur **Mémoire → Aperçu** ; voir [Mémoire — Mettre en quarantaine la mémoire d’un fournisseur](/docs/fr/knowledge/memory/#quarantine-a-providers-memory). Chaque application et chaque levée est écrite dans le journal d’audit (`memory.quarantine.apply` / `memory.quarantine.release`).

### SSH vers un nœud distant {#remote-node-ssh}

L’**invocation SSH** d’un nœud distant (via Nœuds) exécute des commandes protégées ; les motifs de commande **destructeurs** exigent un indicateur de forçage explicite. Les types de nœuds non SSH peuvent renvoyer « non implémenté » pour l’invocation.

### Mémoire au repos {#memory-at-rest}

Les notes durables sont masquées par le module de confidentialité **avant de toucher le disque**, pas à la lecture — une expurgation à la lecture laisserait le texte brut dans le fichier et dans l’index FTS. C’est la même fonction et les mêmes règles que pour le trafic sortant vers les modèles : les dates sont conservées, et les valeurs des classes mask et block sont remplacées, donc un IBAN dans une note est stocké sous la forme `[IBAN]` (les versions précédentes ne remplaçaient que les adresses e-mail et les numéros de téléphone dans les notes). L’enregistrement brut des conversations, les résumés de conversation et les faits restent non masqués dans EYAS et ne sont masqués qu’en sortant. La capture elle-même se règle avec `memory.capture.enabled` dans `config/default.yaml` (défaut **on**). Voir [Mémoire](/docs/fr/knowledge/memory/) et [FAQ](/docs/fr/reference/faq/).

**Les notes écrites par un modèle passent le filtre d’instructions.** Les notes de coffre qu’écrit un modèle — la capture de mémoire par tour, les résumés de la consolidation nocturne et les résumés de session d’équipe — passent le même filtre qu’EYAS utilise déjà pour les faits et les résumés. Un texte qui ressemble à une instruction adressée à l’assistant (*ignore previous instructions*, *from now on you are…*, de fausses balises `<system>`, *delete all memory*, en anglais, hongrois, allemand, espagnol et français) n’est jamais écrit. Les refus apparaissent dans le log du serveur avec le nom du détecteur, jamais avec le texte. Chaque note de ce type porte aussi une `origin` dans son frontmatter et est mémorisée comme écrite par un modèle, jamais comme tes propres mots. Voir [Mémoire — Pourquoi certaines phrases sont refusées](/docs/fr/knowledge/memory/#why-some-sentences-are-refused).

## Politique de confidentialité {#privacy-policy}

EYAS stocke ses données brutes et **masque les données personnelles quand du texte quitte EYAS vers un modèle distant**. Une seule fonction déterministe fait le masquage, pour les prompts, les résultats des outils mémoire, les embeddings et les notes du coffre.

### Comment fonctionne la détection {#how-detection-works}

La détection repose sur des règles et elle est déterministe : le même texte donne toujours le même résultat, et rien n’est jamais envoyé à un modèle pour détecter des données personnelles. Elle est **bornée à la ligne** — une valeur coupée sur deux lignes n’est pas détectée, et un mot « téléphone » ou « fiscal » ne compte que sur la même ligne que le nombre.

Jamais traités comme données personnelles : les dates de calendrier dans toutes les mises en forme courantes (`2026-09-08`, `2026.09.30.`, `2026. 09. 30.`, `22.09.2026`, `09/22/2026`), les heures, les horodatages ISO, les adresses IP, les versions logicielles (`1.0.40`, `0.8.29-beta`), les montants (décimaux, ou nombres à côté d’une devise comme HUF/Ft/EUR/€/$), et les identifiants d’enregistrement, de ticket, de build, de commit et d’horodatage, les UUID, ULID et hashes. La ligne *Current date* du prompt arrive intacte à chaque modèle.

### Ce qui est détecté {#what-is-detected}

| Type | Reconnaissance et validation |
|------|------------------------------|
| `email` | Forme d’adresse standard |
| `phone` | Un numéro international commençant par `+` (8 à 15 chiffres) ; un numéro avec un indicatif régional entre parenthèses ; le format national hongrois (06/36 + indicatif + 6 à 7 chiffres) ; ou tout nombre de 7 à 15 chiffres précédé, dans les 40 caractères sur la même ligne, d’un mot de téléphone. Les mots de téléphone ne comptent que comme mots entiers : phone, tel, mobile, cell, call, fax, WhatsApp, telefon, mobil, hívj, Handy, Telefonnummer, teléfono, móvil, téléphone, Tél., portable, etc. Les numéros écrits librement, sans `+`, sans format national et sans mot de téléphone, ne sont volontairement pas détectés. |
| `iban` | Les IBAN de tous les pays, compacts ou groupés par espaces, validés par la somme de contrôle officielle mod-97 et la longueur exacte du pays (les versions précédentes ne détectaient que les IBAN hongrois) |
| `bank_account` | Numéros de compte giro hongrois, 8-8 ou 8-8-8 chiffres (espace ou tiret), validés par la somme de contrôle par bloc 9-7-3-1 |
| `credit_card` | 13 à 19 chiffres avec un préfixe de réseau de carte, validés par Luhn |
| `ssn` | Numéro de sécurité sociale américain `AAA-GG-SSSS` avec zone, groupe et série valides |
| `personal_id` | Numéro de carte d’identité hongroise (6 chiffres + 2 lettres majuscules) comme jeton isolé |
| `tax_number` | Numéro fiscal hongrois (adószám, `12345676-2-42`) avec chiffre de contrôle valide, code TVA 1 à 5 et vrai code de comitat ; numéro de TVA intracommunautaire hongrois (`HU12345676`) ; et identifiant fiscal personnel hongrois (adóazonosító jel, 10 chiffres commençant par 8) seulement avec un chiffre de contrôle valide **et** un mot d’identifiant fiscal avant lui (adóazonosító, adószám, tax ID, TIN, Steuer-ID, NIF, numéro fiscal, …). Les mots ne comptent que comme mots entiers : `tin` dans *routine* ou `tax` dans *syntax* ne déclenche rien, et un nombre quelconque de 10 chiffres à côté du mot *tax* n’est pas un numéro fiscal. |
| `taj_number` | Numéro TAJ hongrois, validé par son chiffre de contrôle |

Les noms et les adresses postales ne sont pas détectés. Utilise des [motifs personnalisés](#custom-patterns) pour eux et pour tout autre identifiant propre à ton organisation.

Il n’y a pas d’analyseur à base de modèle. L’ancien analyseur NER, qui envoyait en silence le texte du prompt à un Ollama local, a été supprimé ; si `ner` figure encore sous `privacy.scanners` dans `config/personality/privacy.yaml`, il est ignoré et un avertissement est logué.

### Actions {#actions}

Chaque type détecté a une action :

| Action | Effet |
|--------|-------|
| `off` | Ignoré |
| `warn` | Compté et logué ; le texte reste tel quel |
| `mask` | Remplacé par un espace réservé comme `[EMAIL]` ou `[IBAN]` quand le texte quitte EYAS vers un modèle distant |
| `block` | Masqué de la même façon en sortie ; et un **nouveau** message de chat ou de canal qui le contient est refusé avant d’être stocké quand il partirait vers un modèle distant (voir [Messages refusés](#refused-messages)) |

Défauts intégrés : `email` et `phone` sont **mask** ; `iban`, `bank_account`, `tax_number`, `personal_id`, `credit_card` et `ssn` sont **block** ; `taj_number` est **warn**.

**Le masquage n’arrête jamais un appel modèle.** Une valeur de classe block n’importe où dans un prompt — par exemple un IBAN dans une note de mémoire — est masquée et le tour continue ; la capture de mémoire n’échoue pas non plus sur ces tours. `block` n’a qu’un seul effet de plus : il refuse un **nouveau** message que tu envoies.

### Messages refusés {#refused-messages}

Seul un **nouveau** message qu’un utilisateur envoie — dans le chat, dans une conversation God Mode, ou par un canal (Telegram, Slack, Discord, e-mail, WhatsApp, Signal, …) — peut être refusé. Tout le reste de ce qu’EYAS envoie à un modèle (historique, mémoire, résultats d’outils, texte extrait des pièces jointes, embeddings) n’est jamais refusé ; c’est masqué en sortie.

Un message est refusé quand il contient une valeur de classe block **et** qu’il partirait vers un modèle distant. Local signifie que l’hôte du point de terminaison du modèle est loopback (`localhost`, `127.x`, `::1`) ou listé dans les hôtes locaux de la politique ; les fournisseurs CLI (Claude Code, Grok CLI, Kimi CLI) et les points de terminaison inconnus comptent comme distants. La destination est le modèle sur lequel le message va tourner (un changement de modèle pour un seul tour, le modèle fixe de la conversation, ou le modèle de son collègue). Une conversation réglée sur Auto compte toujours comme distante, parce que son modèle est choisi à chaque message après la vérification — sauf si le routage automatique est désactivé globalement, auquel cas c’est son modèle enregistré qui est jugé. En God Mode, chaque participant du roster est jugé ; si l’un d’eux est distant, ou si le roster est vide, le message est refusé. Avec la politique ou le module de confidentialité désactivé, rien n’est refusé.

- **Dans le chat,** le message refusé n’est pas stocké : pas d’entrée dans la transcription, pas de renommage, pas de mémoire, pas d’appel modèle, pas de course God Mode. Une carte au-dessus du compositeur, **Message non envoyé — confidentialité**, liste les types (jamais les valeurs) et propose **Envoyer avec ces données masquées**, **Modifier le message** et **Abandonner**. Voir [Conversations — Messages refusés](/docs/fr/daily/conversations/#refused-messages-privacy).
- **Sur un canal,** l’expéditeur reçoit une réponse automatique dans la langue dans laquelle il a écrit (anglais, hongrois, allemand, espagnol, français ou klingon ; anglais en cas de doute), qui nomme les types, jamais les valeurs, et lui demande de renvoyer le message sans ces valeurs. Aucune conversation, aucun message ni aucune exécution d’agent n’est créé ; l’événement entrant affiche le statut **ignoré** avec l’erreur `privacy_blocked`, et seul son texte masqué est gardé. Voir [Canaux](/docs/fr/communication/channels/#refused-messages).
- Les messages déjà stockés avant un changement de politique ne sont pas refusés après coup.

Chaque refus écrit l’action d’audit `privacy.inbound_refused`, et chaque *envoi masqué* écrit `privacy.inbound_masked` ; les deux enregistrent les types, la conversation (chat) ou l’identifiant de l’événement entrant (canaux) et l’utilisateur — jamais une valeur.

### Motifs personnalisés {#custom-patterns}

Chaque motif personnalisé a un `name`, une `regex`, un slug `type` en minuscules qui devient l’espace réservé (par exemple `[INTERNAL_PROJECT]`), et sa propre `action`. Ajoute-les sur la [page Confidentialité](#privacy) (jusqu’à 50) ; les motifs qui partagent un type utilisent l’action du premier. Les motifs sont bornés à la ligne : ils ne correspondent jamais par-dessus un saut de ligne, et `^` / `$` ancrent au début et à la fin d’une ligne. Un motif dangereux (retour arrière catastrophique) ou qui ne compile pas est ignoré et signalé dans le log du serveur. Un motif qui peut correspondre à une chaîne vide ne bloque plus l’analyseur.

### Hôtes locaux : qui reçoit le texte non masqué {#local-hosts-who-receives-text-unmasked}

Le texte n’est envoyé non masqué que si le point de terminaison du modèle est sur cette machine : un point de terminaison loopback (`localhost`, `127.x.x.x`, `::1`) ou un hôte listé dans les **hôtes locaux** de la politique (jusqu’à 32 noms d’hôte ou adresses IP, sans schéma ni port). C’est l’hôte vers lequel le fournisseur envoie qui décide, jamais le nom du fournisseur :

- Un Ollama ou LM Studio local est exempté ; un **`OLLAMA_HOST` distant est masqué**. Si tu comptais sur l’ancienne exemption d’Ollama pour un hôte Ollama distant, ajoute cet hôte aux hôtes locaux.
- Les hôtes du LAN non listés, les API cloud, les points de terminaison inconnus et tous les fournisseurs CLI (Claude Code, Grok CLI, Kimi CLI) comptent comme distants — EYAS ne peut pas voir où une CLI envoie son trafic.
- L’ancienne action `auto_local` (rediriger vers un Ollama local) n’existe plus ; une ancienne règle `auto_local` est traitée comme `mask`, avec un avertissement dans le log.

### Complétions stockées (OpenAI) {#stored-completions-openai}

Les requêtes vers le fournisseur **OpenAI** intégré refusent explicitement les *stored completions* d’OpenAI, pour le chat, le streaming et les appels d’outils. OpenAI ne conserve donc pas les conversations EYAS pour ses fonctions de distillation ou d’évaluation, même si *store completions* est activé dans ton compte ou ton projet OpenAI. Rien à configurer. Cela tient aussi quand `OPENAI_BASE_URL` redirige le fournisseur OpenAI intégré. Les fournisseurs compatibles OpenAI (xAI, Mistral, Groq, DeepSeek et le reste du catalogue compatible, OpenRouter, Kimi API, LM Studio) ne reçoivent pas ce drapeau, car certains de ces services refusent les paramètres inconnus ; ce qu’ils conservent dépend de leurs propres réglages de compte et conditions. Les embeddings ne sont pas concernés.

### Où s’applique le masquage {#where-masking-applies}

Le masquage a lieu dans la passerelle de modèles, à **chaque tentative, pour le fournisseur qui répond réellement**. Si un appel est relancé ou bascule vers le fallback d’un niveau, chaque tentative est masquée pour sa propre destination : un Ollama local en primaire reçoit le texte brut, et s’il échoue et que l’appel passe à un fallback cloud, le fournisseur cloud reçoit le texte masqué. La vérification de routage rapide qui précède un tour de chat est masquée elle aussi.

Pour une destination distante, EYAS masque :

- le prompt système, section par section : mémoire, fichiers de persona et d’agent, contexte de projet, compétences, designs, et tout texte qu’EYAS ne peut attribuer à aucune section ;
- l’historique de la conversation ;
- les résultats des outils mémoire d’EYAS, y compris leurs textes d’erreur : `memory_search`, `search_memory`, `memory_expand`, `search_knowledge`, `get_page`, `read_team_memory` ;
- les textes envoyés à un fournisseur d’embeddings distant.

Non masqués :

- les sections qu’EYAS écrit lui-même — identité, règles de base, le bloc runtime avec la date et l’heure, les dossiers de travail, les listes d’outils, de compétences et d’agents, la directive d’orchestration — pour que le modèle lise toujours la date du jour et ses dossiers mot pour mot ;
- les résultats des outils d’espace de travail (fichiers, shell, git, grep, navigateur, documents, recherche de code). Les outils natifs des CLI ne peuvent de toute façon pas être masqués, et le masquage réécrirait des espaces réservés comme `[EMAIL]` dans les fichiers que le modèle édite.

Un même élément de mémoire est masqué à l’identique, qu’EYAS le place dans le prompt ou que le modèle aille le chercher avec un outil mémoire — c’est la même fonction. C’est vrai sur **chaque chemin** par lequel un modèle peut lire la mémoire EYAS :

- les fournisseurs dont la boucle d’outils tourne dans EYAS (fournisseurs API et locaux) ;
- les outils EYAS internes au processus de Claude Code (`mcp__eyas__*`) ;
- Grok CLI et Kimi CLI via le pont MCP d’EYAS ;
- les clients MCP extérieurs qui appellent le serveur MCP propre d’EYAS (`POST /api/v1/mcp/tools/call`) ;
- le sidecar OpenCode : le prompt de tâche `opencode_run` et la mémoire rappelée envoyée comme son texte système sont masqués avant d’atteindre OpenCode (le titre de la session OpenCode vient du prompt masqué), et de même les réponses de `memory_search` / `memory_expand` dans OpenCode.

Une CLI, un client MCP extérieur et OpenCode comptent toujours comme distants, parce qu’ils peuvent faire tourner n’importe quel modèle : rien dans une requête ne peut les rendre locaux, et la liste des hôtes locaux ne les exempte pas. Les valeurs des classes mask et block sont remplacées par des espaces réservés `[TYPE]` ; les dates, heures, identifiants, nombres et la structure JSON sont conservés.

**Échec en fermé.** Si l’analyse de confidentialité elle-même échoue, le résultat de l’outil mémoire n’est pas envoyé : le modèle reçoit *Error: memory tool result withheld (privacy scan failed)*, et une tâche OpenCode échoue avec *privacy scan failed — the task was not sent to OpenCode* — rien n’atteint OpenCode. Le log n’enregistre que des types, des nombres et l’identité (conversation, exécution, agent, tour, outil, transport), jamais une valeur : *Privacy: masked values in a tool result sent past the model gateway*, ou *warn-class values in a tool result sent past the model gateway*.

Un changement de politique prend effet au tour suivant. Un tour déjà en cours garde la politique avec laquelle il a démarré, pour qu’une boucle d’outils soit masquée de façon cohérente.

### Où vit la politique {#where-the-policy-lives}

La politique est stockée dans la base EYAS. `config/personality/privacy.yaml` en est la graine : il est réimporté automatiquement quand le fichier change, sans redémarrage, jusqu’au premier enregistrement de la politique sur la [page Confidentialité](#privacy). Ensuite, la politique enregistrée l’emporte et les modifications du fichier sont ignorées avec un avertissement dans le log.

Un `privacy.yaml` absent ou invalide ne retombe plus en silence sur les défauts : l’erreur est loguée avec le chemin complet du fichier et les raisons, et la dernière politique valide reste en vigueur. Sur une première install sans fichier lisible, les défauts intégrés s’appliquent.

L’ancien format (`scanners` / `rules` / `custom_patterns`) est toujours accepté :

- Pour chaque type, la première règle qui correspond décide ; un type qu’aucune règle ne couvre est `warn`.
- `sanitize` devient `mask` ; `auto_local` devient `mask` avec un avertissement ; `ner` est ignoré avec un avertissement.
- Un analyseur absent de `scanners` coupe ses détections.
- Les règles ou motifs inutilisables sont écartés avec un avertissement.

**Audit.** Avec `audit` activé, chaque appel modèle qui a masqué (ou signalé) quelque chose écrit **une** entrée d’audit, action `privacy.egress`, ciblée sur la conversation. Elle remplace les anciennes entrées `privacy.detected` à une entrée par correspondance, qui ne sont plus écrites. L’entrée liste les identifiants de conversation, d’exécution, d’agent et de composition (ou de tour) ; le fournisseur ; la destination (distante) ; le transport (`gateway`, `embed`, `mcp-bridge`, `mcp-external`, `opencode`) ; la version de la politique ; les nombres de valeurs masquées et signalées ; les nombres par type ; les sections du prompt concernées (`unattributed` = texte système hors des sections enregistrées) ; le nombre de correspondances dans l’historique de la conversation ; et les outils mémoire concernés. Un résultat d’outil mémoire envoyé au-delà de la passerelle reçoit sa propre entrée. Les valeurs détectées ne sont jamais loguées ni stockées. Les changements de politique sont toujours audités sous `privacy.policy.updated` (version, source, types modifiés et l’utilisateur qui a enregistré — jamais de valeurs). Les lignes de log disent *Privacy: masked values in outgoing model traffic* ou *warn-class values in outgoing model traffic*, et nomment désormais aussi la conversation, la composition, les sections et les outils. L’inspecteur de contexte montre par section du prompt ce qui a été masqué — voir [Conversations — Composition du contexte](/docs/fr/daily/conversations/#context-composition).

**Mise à jour.** Rien à faire : les `privacy.yaml` existants à l’ancien format continuent de fonctionner, et un `privacy.yaml` existant continue d’alimenter la politique jusqu’au premier enregistrement sur la page. Un texte que l’ancien analyseur a stocké avec une date remplacée par `[PHONE]` — par exemple dans une note du coffre — n’est pas réparé automatiquement, parce que la valeur d’origine est perdue ; le réimporter depuis la source le restaure.

## Champs et commandes

### Événements de sécurité (`/security`) {#security-events}

Sous-titre : *Décisions d'exécution des outils et journal d'audit de sécurité.*

La page s’ouvre sur la carte **Mémoire hors d’EYAS** (propriétaires et admins) — voir [plus haut](#memory-outside-eyas-card).

| Commande | Signification |
|----------|---------------|
| Statistiques | **Total des événements**, **Taux de refus**, **Outils les plus bloqués** |
| Filtre de décision | **Tous / Autoriser / Refuser / Escalader** |
| Filtre de risque | **Tous / faible / moyen / élevé / critique** |
| Filtre de point de contrôle | Texte libre (*Filtrer le point de contrôle…*) — `deterministic` pour les refus de chemin comme la mémoire hors d’EYAS |
| Colonnes | Horodatage, Outil, Décision, Point de contrôle, Risque, Agent, Motif |

Vide : *Aucun événement de sécurité trouvé.*

### Audit (`/audit`) {#audit}

Sous-titre : *Journalisation des actions, instantanés et suivi des restaurations.*

| Commande | Signification |
|----------|---------------|
| Statistiques | **Total des entrées**, **Actions / jour**, **Module principal**, **Coût total** |
| Filtres | **Action**, **Module**, **Du**, **Au** |
| Colonnes | Horodatage, Utilisateur, Action, Module, Cible, Résultat, Coût |
| **Rétablir** | Restaurer depuis un instantané (avec confirmation) |

Résultats : **succès / erreur / refusé / rétabli**.

### Confidentialité (`/privacy`) {#privacy}

La page a trois parties. (Avant cette version, chaque appel à l’API Confidentialité était rejeté comme non authentifié, si bien que la page pouvait renvoyer à l’écran de connexion ; c’est corrigé.)

**1. Statistiques** (en haut de la page). Des compteurs du trafic réel depuis le démarrage du serveur — gardés en mémoire, donc un redémarrage les remet à zéro ; *Depuis le démarrage du serveur : &lt;heure&gt;* indique quand ils ont commencé, et **Actualiser** les recharge. Les passages du testeur d’analyse ne sont jamais comptés.

| Compteur | Signification |
|----------|---------------|
| **Appels distants vérifiés** | Les charges sortantes analysées pour une destination distante : chaque tentative d’appel modèle (les nouvelles tentatives et les sauts vers le fallback d’un niveau comptent à part), les embeddings envoyés à un embedder distant, et les résultats d’outils mémoire envoyés au-delà de la passerelle (ponts Claude Code / Grok / Kimi, clients MCP extérieurs, sidecar OpenCode). Les appels vers une destination locale ne sont ni analysés ni comptés |
| **Appels avec valeurs masquées** | Parmi eux, combien avaient au moins une valeur remplacée |
| **Messages refusés** | Nouveaux messages de chat, de God Mode et de canal refusés à cause d’une valeur de classe block |
| **Envoyés masqués sur demande** | Messages de chat refusés que l’expéditeur a ensuite envoyés avec **Envoyer avec ces données masquées** |
| **Types de PII détectés** | Détections par type, avec *Détections par analyseur* (regex / custom) |

**2. Éditeur de la politique de confidentialité.** Un en-tête avec la version de la politique (*Version N*) et sa provenance : *Importée depuis config/personality/privacy.yaml…* (réimportée à chaque modification du fichier, jusqu’à ce que tu enregistres ici), *Gérée sur cette page. Les modifications de privacy.yaml sont ignorées.*, ou *Valeurs par défaut intégrées : privacy.yaml n’a pas pu être lu.* Tant que la politique vient encore du fichier, une bannière rouge *Problème dans privacy.yaml : &lt;erreur&gt;* signale un fichier absent ou invalide, avec son chemin complet.

| Commande | Signification |
|----------|---------------|
| **Politique de confidentialité activée** | Désactivée : rien n’est détecté, masqué ni refusé |
| **Audit** | Consigner dans le journal d’audit chaque appel modèle ou résultat d’outil mémoire contenant des valeurs masquées ou signalées (types et nombres, jamais les valeurs). Les changements de politique sont toujours audités |
| **Action par type** | Une légende des quatre actions (**Désactivé**, **Avertir**, **Masquer**, **Bloquer**, chacune expliquée) et une ligne par type intégré (`email`, `phone`, `iban`, `bank_account`, `credit_card`, `ssn`, `personal_id`, `tax_number`, `taj_number`) avec son nom, une description d’une ligne de ce qui est détecté, et un sélecteur d’action |
| **Motifs personnalisés** | Des lignes **Nom**, **Expression régulière**, **Type** (un slug en minuscules comme `project_code` ; en majuscules, il devient l’espace réservé, p. ex. `[PROJECT_CODE]`) et **Action** ; **Ajouter un motif** / **Supprimer le motif** ; jusqu’à 50. Les motifs s’appliquent ligne par ligne ; les motifs qui partagent un type utilisent l’action du premier. Une expression régulière dangereuse (retour arrière catastrophique) ou invalide est refusée à l’enregistrement, avec la raison sous le champ |
| **Hôtes locaux** | Noms d’hôte ou adresses IP (sans schéma, port ni chemin ; jusqu’à 32) dont les points de terminaison de modèle reçoivent le texte non masqué, comme localhost. Une saisie invalide est refusée avant l’enregistrement |
| **Enregistrer la politique** / **Annuler les modifications** | Avec un marqueur *Modifications non enregistrées*. L’enregistrement remplace toute la politique et la stocke dans la base ; dès lors, la politique est gérée sur cette page et les modifications de `privacy.yaml` sont ignorées (un avertissement est logué). Elle s’applique dès le prochain appel au modèle — un tour déjà en cours garde la politique avec laquelle il a démarré. Si le serveur refuse la politique, rien ne change et chaque problème est affiché à son champ |

Seul le propriétaire peut modifier la politique. Les admins la voient en lecture seule avec *Vous pouvez consulter la politique. Seul le propriétaire peut la modifier ou utiliser le testeur d’analyse.* Un opérateur peut tout désactiver ; ce changement est audité.

**3. Tester l’analyseur PII** (propriétaire seulement). Colle jusqu’à 100 000 caractères et **Analyser le texte**. Le testeur utilise toujours la politique **enregistrée** (une indication apparaît tant que l’éditeur a des modifications non enregistrées). Résultats : le verdict pour un nouveau message — *Un nouveau message contenant ce texte serait refusé : &lt;types&gt;.* ou *Un nouveau message contenant ce texte serait accepté.* ; chaque détection avec son type, sa position, son analyseur et son action ; et **Tel que le reçoit un modèle distant** — le texte avec les valeurs des classes mask et block remplacées (les valeurs de classe warn restent). *La politique de confidentialité est désactivée : rien n’est détecté.* quand la politique est désactivée.

**API (intégrateurs).**

- `GET /api/v1/privacy/policy` (propriétaire et admin) → `{policy: {enabled, actions, customPatterns, localHosts, audit}, version, source ('yaml'|'ui'|'defaults'), seedError, updatedAt, rulesetVersion, builtinTypes, actions, limits: {customPatterns: 50, localHosts: 32}, canManage}`.
- `PUT /api/v1/privacy/policy` (propriétaire) — le corps est la politique entière (les champs omis prennent leur défaut ; les clés inconnues sont refusées) → la même forme que `GET`, ou `400 {code: 'invalid_policy', issues: [{path, code, message}]}` sans aucun changement (les codes incluent `unsafeRegex`, `invalidRegex`, `invalidHost`, `invalid_enum_value`, `too_big`, `unrecognized_keys`).
- `POST /api/v1/privacy/scan` (propriétaire ; `text` non vide, au plus 100 000 caractères) → `{enabled, rulesetVersion, matches: [{type, start, end, scanner, action, value: '***'}], inbound: {refused, types}, egressPreview}`. Les champs `blocked`, `blockedTypes`, `warnings`, `sanitizedText` et `confidence` ont disparu. Non compté dans les statistiques.
- `GET /api/v1/privacy/stats` (propriétaire et admin) → `{since, egress: {calls, maskedCalls, byType}, inbound: {checked, refused, masked}, byScanner}` ; `totalScans`, `totalDetections`, `detectionsByType`, `detectionsByScanner` et `detectionsByAction` ont disparu.
- `/api/v1/privacy/*` exige l’en-tête `X-Eyas-Request` sur les appels modifiants faits avec un cookie de session, comme les autres API d’administration (l’UI web l’envoie ; les clés API et jetons Bearer ne sont pas concernés).

## Voir aussi

- [Autonomie](/docs/fr/agents/autonomy/)
- [Utilisateurs](/docs/fr/admin/users/)
- [Outils](/docs/fr/automation/tools/)
- [Observabilité](/docs/fr/admin/observability/)
- [Nœuds](/docs/fr/admin/nodes/)
- [Mémoire](/docs/fr/knowledge/memory/)
- [OpenCode](/docs/fr/automation/opencode/)
- [CLI](/docs/fr/deploy/cli/)
