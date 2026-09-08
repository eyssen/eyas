---
title: Import et export de données
description: Assistant d’import pour mémoire, compétences et règles de workspace — scanner, choisir, approuver.
---

**À quoi ça sert.** Data-port est l’**assistant d’import**. Il scanne un chemin serveur ou un zip/markdown téléversé depuis un autre assistant (Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot, Obsidian, un export de conversation, un export EYAS antérieur ou un simple dossier Markdown) et propose où le classer. La mémoire peut s’appliquer ; règles et identité de workspace sont **proposition seulement** jusqu’à l’approbation du merge. Pas un dump de BD — utilise [Sauvegarde](/docs/fr/admin/backup/). L’export est **Bientôt**.

**Emplacement :** Paramètres → **Portabilité des données**. En-tête : *Importez la mémoire, les compétences et les règles depuis d'anciens systèmes d'IA. L'export arrivera plus tard.*

## Quand l'utiliser

- Notes durables de `~/.claude` ou d’un vault Obsidian `ai-memory` vers EYAS (la seule mémoire que les tours suivants liront).
- Compétences custom Claude/Cursor → catégorie **own**.
- Règles/identité comme propositions de merge, jamais d’auto-écrasement.
- Un zip d’un export antérieur scanné sans copier les fichiers à la main sur le serveur.

## Déroulement typique

1. **Paramètres** → **Portabilité des données** → **Importer des données…**
2. **Système source** : **Détection automatique**, Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf / Codeium, GitHub Copilot, Obsidian, Export de conversation, Export EYAS, Dossier Markdown. Les ids utilisés par l’API sont `claude-code`, `grok-cli`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `copilot`, `obsidian`, `chat-export`, `eyas-export` et `generic-md`.
3. **Chemin serveur** (absolu sur cette machine) **ou** **Choisir un fichier…** (zip ou un seul markdown/JSON). Les **Instructions** facultatives guident le classement.
4. **Analyser**. Passe l’arborescence des dossiers et les groupes en revue (Mémoire, Index de mémoire, Sessions, Compétences, Règles, Identité, Personas d’agent, Connaissance, Code source, Non importable) et choisis ce qui reste. Laisse **Enrichir les métadonnées avec le modèle** décoché pour un import entièrement déterministe.
5. **Importer N éléments**. Mémoire/compétences s’appliquent ; règles/identité attendent comme **Propositions de modification de l'espace de travail** — **Approuver la fusion** ou **Rejeter**.

## Fonctions

| Capacité | Signification |
|----------|---------------|
| Import | Chemin sur le serveur et/ou téléversement (zip) |
| Cibles | Mémoire (kind + niveau), sessions épisodiques, compétences avec leurs fichiers joints, personas d’agent, règles de workspace, prompt du type de projet |
| Merge | **Proposition seulement** pour règles/identité — appliqué après approbation explicite |
| Enrichissement | **Désactivé par défaut** — une case à cocher facultative, métadonnées seulement, jamais le corps |
| Langue | La mémoire importée garde la langue source |
| Catégorie de compétences | Importé → **own** |
| Annulation | Annuler un job entier — nécessite la permission **`delete`** sur Data Port |
| Export | **Bientôt disponible** — un paquet `eyas-export-v1` (vault, compétences, workspaces, `episodic.jsonl`). Un paquet peut transporter des notes porteuses d’identifiants : avant sa sortie, la route recevra le même test d’appelant réservé au propriétaire que celui qui protège le rappel de mémoire ; `create` sur Data Port ne suffira pas |

## Ce qui atterrit où

Le dossier parfait n’est pas exigé. **Tout ce qui est sous le chemin est cartographié.** Il n’y a ni liste de conservation ni plafond : le scan parcourt chaque répertoire sous la racine, quelle qu’en soit la taille. Une arborescence dix fois plus grande qu’un répertoire personnel habituel est listée et importée en entier — le coût est du temps et du disque, jamais un oubli. Seules les *classes* de répertoire qui ne peuvent jamais contenir de mémoire ne sont pas parcourues : dossiers de dépendances (`node_modules`), de gestion de versions (`.git`, `.hg`, `.svn`), `.cache`, `__pycache__`, `.venv` / `venv`, sorties de build (`dist`, `build`, `out`, `.next`, `.turbo`, `target`) lorsqu’un manifeste de build se trouve à côté, racines de profil de navigateur (Chrome, Chromium, Firefox, Antigravity — reconnues à leurs fichiers marqueurs, où qu’elles soient), racines de stockage cloud (`Library/CloudStorage` et `Library/Mobile Documents`, reconnues à l’emplacement que macOS leur donne, ainsi que les anciens dossiers de synchronisation comme Dropbox, reconnus à leurs propres fichiers marqueurs — un dossier simplement *nommé* OneDrive ou Dropbox est un dossier ordinaire et il est parcouru), la corbeille (`.Trash`, `.Trashes`, `$RECYCLE.BIN`, `.local/share/Trash`) et `Library/Caches`. Chacune reste **une ligne visible** portant son nombre de fichiers et le motif *Dossier non parcouru : `<classe>`*, donc rien ne disparaît en silence. Un répertoire atteint par lien symbolique est parcouru une seule fois — le chemin réel tranche — et une boucle est signalée plutôt que reparcourue. `.DS_Store` est listé comme état d’application.

| Source | Couche EYAS |
|--------|-------------|
| Note avec `type: user` / `feedback` / `project` / `reference` (Claude Code, Obsidian, Grok) | Note du coffre portant ce même **kind** ; `feedback` sous `procedural/`, le reste sous `semantic/` ; le fichier garde le **nom du fichier source**, donc les `[[wikiliens]]` continuent de se résoudre |
| Index `MEMORY.md` | Une seule note du coffre taguée `index` ; une ligne d’accroche devient le résumé de la note qu’elle désigne lorsque cette note ne déclare pas sa propre `description` |
| Résumés de session, notes de session (`type: claude-session` / `grok-session`) et transcriptions — `*.jsonl` Claude Code y compris celles des sous-agents, transcriptions d’agent Cursor, rollouts Codex, exports ChatGPT / Claude.ai | Mémoire épisodique, une ligne par session — une session très longue en parties ordonnées, jamais coupée — les tours conservés tels quels. **Tout est coché par défaut** ; si vous n’en voulez pas, décochez le groupe *Sessions*. La sortie d’outil enregistrée à côté d’une session est listée mais non cochée |
| Anciens dossiers de mémoire (`memory.local-backup-*`, `memory.old`, `*.bak`) | Note du coffre taguée `legacy` ; un nom déjà pris reçoit un frère `-2` au lieu d’être écarté |
| Vos propres documents, n’importe où sous la racine | Note du coffre ; le kind vient de `type:` quand la note en déclare un, sinon `reference` |
| Documentation produit tierce | Note du coffre taguée `third-party`, cochée — si vous n’en voulez pas, décochez le groupe |
| Fichiers de règles à l’intérieur des dépôts (`.cursor/rules/*.mdc`, `.cursorrules`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `global_rules.md`) | Proposition, où qu’ils soient dans l’arborescence |
| Fichiers de code source | Listés et importables, mais **non** cochés — ce ne sont ni de la mémoire ni des instructions |
| Texte de données et de configuration (`.yaml`, `.toml`, `.csv`, `.log`, le `settings.json` d’un assistant …) | Listés et importables, mais **non** cochés |
| `SKILL.md` avec `references/` et `scripts/` | Une compétence **own** : le paquet entier tel quel, les fichiers étant aussi copiés dans `data/skills/imported/<nom>-<hash>/`. Le corps de la compétence nomme ce répertoire par son **chemin absolu sur le disque**, pour qu’un script joint puisse être lancé directement depuis là |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.mdc` Cursor, règles Windsurf et Copilot | Proposition pour l’`AGENTS.md` de l’**assistant principal** — ou, si vous choisissez *Prompt du type de projet*, pour le type de projet `general` — ajoutée à l’approbation, jamais écrasée |
| Personas `.claude/agents/*.md` | Définitions d’agent (noms d’outils mappés vers les outils EYAS) |

**Rien n’est coupé ni ignoré en silence.** Les fichiers sont lus en entier au moment de l’import et il n’y a aucune limite de taille : un fichier texte de plus de 4 Mio (50 Mio pour un export de conversation) est importé intégralement et porte seulement un marqueur de taille sur sa ligne. Les corps sont écrits **octet par octet**, lignes vides initiales et finales comprises ; l’unique saut de ligne final ajouté par l’écrivain du coffre et une marque d’ordre des octets UTF-8 supprimée sont les seules modifications. Chaque élément appliqué note quel adaptateur l’a réellement lu (`source.adapter`, et le tag `source:<adaptateur>` — un résumé Grok trouvé sous un job Claude Code détecté automatiquement est tagué `grok-cli`), chaque chemin où le contenu a été trouvé, et le sha256 de son contenu dans le registre — pour les notes du coffre, les lignes épisodiques, les compétences, les fichiers joints des compétences, les agents et les propositions. Le frontmatter d’origine, le chemin, le hash et la date de modification voyagent avec la note sous `source:`. Tout fichier que le scan n’importe pas est une ligne visible avec son motif. Relancer un import renvoie **Inchangé** pour les notes déjà présentes et n’écrase jamais : une note différente portant le même nom reçoit un suffixe `-2` et le tag `conflict-with:`. Réimporter un fichier de règles non encore approuvé n’empile pas une seconde proposition pour lui.

**Un projet ou un type de projet déclaré qui n’existe pas encore n’est pas perdu.** Quand le frontmatter d’une note importée déclare un `project` (ou `projectType`), l’importateur ne la classe sous `projects/<id>/` (ou `project-types/<id>/`) que si ce projet ou ce type de projet existe déjà dans cette instance EYAS ; sinon elle arrive sans portée, taguée `declared-project:<id>` (ou `declared-project-type:<id>`). Créer le projet ensuite et réimporter la classe alors sous l’identifiant déclaré, ou vous pouvez déplacer la note vous-même.

**N’importe quel assistant.** Des adaptateurs reconnaissent les sources : Claude Code, Grok CLI, Cursor, Codex CLI, Gemini CLI, Windsurf, GitHub Copilot (structure documentée seulement), Obsidian, exports JSON ChatGPT / Claude.ai / génériques, eyas-export et markdown simple (`generic-md`). Un fichier atteint par plusieurs chemins (un coffre lié dans `~/.grok/memory`) devient une seule note.

**L’enrichissement par le modèle est désactivé par défaut.** L’étape de revue porte la case **Enrichir les métadonnées avec le modèle**. Laissée décochée — le cas normal — tout l’import est déterministe et ne dépense aucun appel au modèle. Cochée, avec un modèle configuré, les notes *sans* type déclaré reçoivent un kind suggéré, un résumé et des tags. Il n’y a pas de plafond d’éléments ; le coût est du temps. Le corps n’est jamais réécrit, rien n’est écarté sur décision du modèle, et un élément tagué `contains-secrets` n’est jamais envoyé. Le panneau de résultat indique combien de notes ont été enrichies.

**Annuler.** Chaque job peut être annulé depuis le panneau de résultat ou la liste *Imports précédents* : notes, lignes épisodiques, compétences (et leurs fichiers copiés), agents et sections de règles approuvées sont supprimés ; les propositions en attente sont rejetées. L’annulation est destructive, elle exige donc la permission **`delete` sur Data Port** — avec les valeurs livrées, propriétaire et admin seulement ; pour les autres le bouton échoue sur une erreur de permission. Une note du coffre que vous avez **modifiée depuis l’import** est laissée telle quelle et signalée comme *ignorée* au lieu d’être supprimée.

Les outils de lecture restent ouverts sur les chemins mémoire de l’hôte pour que cet importateur puisse y recopier les notes ; l’écriture et le shell vers `~/.claude` / `~/.grok` / `ai-memory` sont refusés. Voir [Mémoire](/docs/fr/knowledge/memory/).

## Secrets

Un fichier que l’heuristique de secrets signale est **importé tel quel, comme tout autre fichier**, et tagué `contains-secrets`. Rien n’est jamais écarté parce que cela contient un identifiant — la sécurité est ici une mesure de *rappel*, pas une mesure d’import. Le tag voyage comme tag de note, capacité de compétence, tag épisodique et `[contains-secrets]` dans le titre d’une proposition, et l’assistant marque la ligne pour que vous la voyiez avant d’importer.

L’heuristique cherche un bloc de clé privée, un jeton de fournisseur, un littéral `KEY=value` ou un nom de fichier en forme de `.env`. Le code qui *consulte* un secret — `keychain_lookup(...)`, `os.environ[...]`, `getenv(...)` — et les espaces réservés de documentation comme `<your-key>`, `xxx` ou `.env.example` ne sont pas signalés.

**Ce que fait le tag.** Une note, une ligne épisodique ou une compétence taguée `contains-secrets` reste en dehors de tout ce que le modèle atteint de lui-même : l’index permanent de la mémoire, le travail connexe, `search_memory`, la tâche de réflexion, le consolidateur nocturne, l’appariement des compétences et le prompt système assemblé. Elle n’est jamais remise au modèle d’enrichissement facultatif et n’est jamais vectorisée. Sur la page Mémoire, vous la voyez toujours en entier. Pour l’ouvrir au modèle, mettez `memory.recall.includeSecrets: true` dans `config/local.yaml` et redémarrez — voir [Configuration](/docs/fr/deploy/configuration/).

**C’est une porte contre l’inclusion automatique, pas un bac à sable du système de fichiers.** Le tag empêche un élément signalé d’entrer de lui-même dans un prompt. Il n’empêche pas un agent doté d’outils de lecture de fichiers de lire le fichier d’origine sur le disque, et il ne chiffre rien. Si un identifiant n’a rien à faire sur cette machine, faites-le tourner : le rôle de l’importateur est de le tenir hors d’un prompt que vous n’avez pas demandé, pas de le rendre inaccessible.

**Deux genres ne sont pas filtrés, parce que là le contenu *est* le prompt.** Une persona d’agent importée et un fichier de règles de workspace approuvé sont utilisés **tels quels dans les prompts de l’assistant** : un identifiant qu’ils contiennent atteint donc le modèle à chaque tour et le filtrage du rappel ne s’y applique pas — les filtrer désactiverait précisément l’agent que vous avez importé. Ils sont tout de même tagués `contains-secrets` pour que vous les retrouviez, et l’assistant d’import dit la même chose sur ces lignes : relisez-les avant d’importer.

**Les fichiers en forme d’identifiants** — `.env`, `credentials.json`, fichiers de clé — sont listés et importables, mais **non cochés**. Une note, une règle, une compétence ou une transcription qui ne fait que *contenir* une clé garde son propre kind, reste cochée et porte le tag.

## Échelle

Chaque candidat est une ligne en base, si bien que ni l’assistant ni le serveur ne détiennent jamais la liste entière.

**Le scan tourne en arrière-plan.** Il répond aussitôt et l’arborescence se remplit pendant qu’il parcourt, en indiquant dossiers visités, fichiers vus et lignes listées. Un répertoire personnel entier prend des minutes. Vous pouvez l’arrêter, et ce qu’il a cartographié jusque-là reste consultable.

**L’étape de revue est une arborescence de dossiers, une liste virtualisée et un aperçu.** Chaque dossier est cartographié, y compris les classes non parcourues — elles affichent leur nombre de fichiers et la classe qui a tenu le parcours à l’écart. **Tout sélectionner (importable)**, **Tout désélectionner** et **Revenir à la suggestion** agissent sur le scan entier. En dessous, la sélection se fait par geste et non ligne à ligne : chaque dossier et chaque genre portent une case à trois états, donc un clic décoche toutes les transcriptions dans tous les dossiers. Le nombre à côté de chaque case est la réponse du serveur lui-même pour la sélection à l’écran : ce que vous lisez est ce que l’import classera. L’aperçu montre les premiers 64 Kio d’un fichier ; l’import le prend quand même en entier.

**L’import se fait en flux.** Les éléments partent par lots de 100, chaque lot est validé, l’avancement est signalé tous les 100 éléments et l’index de recherche est reconstruit une seule fois à la fin. Vous pouvez l’arrêter après le lot en cours — ce qui est déjà classé reste et peut être annulé. Si le serveur redémarre en plein import, le job reprend à son dernier lot validé au lieu de tout recommencer. Le temps de scan et le temps d’import sont tous deux affichés.

**C’est un seul gros fichier qui fixe la borne mémoire, pas l’arborescence entière.** Importer un conteneur — une transcription, un export de conversation, une base Codex — coûte plusieurs fois sa propre taille de fichier en mémoire transitoire, parce que le fichier est tenu en un seul tampon pendant que chaque unité qu’il contient est rendue. Combien de fois dépend de ce qu’est le fichier : environ trois pour une transcription à une ligne par tour, et sept ou plus pour un export de conversation, analysé d’un bloc en un seul graphe d’objets. La phase d’import coûte plus que le scan : une transcription de 19 Mo a mesuré 100 Mio au scan et 235 Mio à l’import. Un export de conversation de 90 Mo culmine près de 900 Mio résidents, ce pour quoi le défaut de 1Gi du chart Helm a de la place, et pas le starter hérité à 512Mi.

**La mémoire par ligne reste plate, quel que soit le nombre de lignes.** Une fois le scan terminé, rien n’est conservé : un second scan du même arbre de 26 000 lignes n’ajoute strictement rien au tas. La mémoire résidente peut malgré tout paraître élevée ensuite, parce que l’allocateur garde les pages qu’il a déjà demandées au système — c’est l’allocateur, pas le scan. La borne vient de votre plus gros fichier isolé, pas de la taille de l’arbre.

**Relancer n’ajoute que ce qui est nouveau.** Tout ce qui est déjà présent renvoie **Inchangé**, et un import ultérieur n’annule jamais un import antérieur.

Deux faits du moteur, dits pour que rien ne vous surprenne :

- Un fichier joint de compétence de plus de 200 000 caractères est intégré au corps de la compétence jusqu’à ce point, avec un marqueur nommant la copie complète. La copie dans le répertoire de ressources de la compétence est exacte à l’octet près et complète.
- Un seul fichier texte plus grand qu’une valeur texte que le moteur peut tenir (environ 512 Mio) est listé, haché et sélectionnable comme n’importe quel autre, mais signalé avec le motif *Plus grand qu’une valeur texte que le moteur peut tenir* au lieu d’être classé. La ligne dit pourquoi.

**Une réserve sur l’identité.** Les sessions et les compétences n’ont pas d’identité de chemin — elles sont reconnues au condensat de leur contenu. Une modification portant uniquement sur des espaces dans un fichier source, après un import, produit donc une *deuxième* ligne épisodique (et une deuxième compétence quand le paquet joint des fichiers) au lieu de mettre à jour la première. Les notes du coffre, qui ont bien une identité de chemin, sont ré-estampillées sur place.

## Champs et contrôles

<h2 id="wizard">Assistant d’import</h2>

Étapes : **source → scanning → review → running → done**.

| Contrôle | Signification |
|----------|---------------|
| **Système source** | Profil de la liste ci-dessus |
| **Chemin serveur** | Chemin absolu — un dossier ou un répertoire personnel entier. Choisir un **Système source** autre que la détection automatique affiche ses **Emplacements habituels**, directement issus de l’adaptateur |
| **Téléverser une archive ou un fichier** | ZIP d'un export antérieur, ou un seul fichier markdown/JSON. La limite de 50 Mio ne vaut que pour le téléversement ; un scan par chemin n’en a aucune |
| **Instructions** | Facultatif — ce qu’il faut rechercher. Cela guide seulement le classement ; rien n’est écarté à cause d’elles |
| **Analyser** | Cartographier l’arborescence en arrière-plan — dossiers visités, fichiers vus, lignes listées, et **Arrêter le scan** |
| Dossiers trouvés par le scan | Tous les dossiers cartographiés par le scan, avec bascules par dossier, comptages de sous-arbre et **Motifs portés par les lignes de ce dossier** — importables ou non, y compris la classe d’un dossier non parcouru |
| Filtre par type | **Tous / Mémoire / Index de mémoire / Sessions / Compétences / Règles / Identité / Personas d'agent / Connaissance / Code source / Non importable** |
| **Tout sélectionner (importable) / Tout désélectionner / Revenir à la suggestion** | Sélection en masse sur le scan entier, pas seulement sur la page |
| Cases de dossier et de genre | Trois états — un clic coche ou décoche tout ce qui est importable sous un dossier, ou toutes les lignes d’un genre dans tous les dossiers |
| **Aperçu** | Les premiers 64 Kio du fichier — l’import le prend quand même en entier |
| **Enrichir les métadonnées avec le modèle** | Désactivé par défaut — facultatif, métadonnées seulement, jamais le corps, jamais un élément signalé |
| **Importer N éléments** | Lancer le job en arrière-plan |
| **Arrêter cet import** | S’arrête après le lot en cours ; ce qui est classé reste |
| Stats | **Sélectionnés / Appliqués / Inchangés / Propositions / Ignorés / Erreurs** |
| **Ignorés, par motif** | Comptage par code de motif (voir ci-dessous) |
| **Analysé en / Importé en** | Combien de temps a duré chaque phase |
| **Approuver la fusion / Rejeter** | Propositions de workspace — jamais d’auto-merge |
| **Annuler cet import** | Annuler le job entier — nécessite `delete` sur Data Port |
| **Imports précédents** | Les cinq derniers jobs, chacun avec son bouton d’annulation |

Scan vide : *Rien d'importable trouvé à cet emplacement.*

## Codes de motif

Chaque ligne de la liste de revue porte un motif, et tout résultat qui n’est pas une application propre est compté sous **Ignorés, par motif**. Les deux viennent d’un vocabulaire fixe — jamais du texte libre — pour que l’assistant affiche le libellé ci-dessous pendant que l’API et les journaux portent le code.

| Code | Signification |
|------|---------------|
| `directory-skipped` | Classe de dossier jamais parcourue — une ligne comptée, avec son nombre de fichiers et la classe |
| `binary` | Fichier binaire |
| `outside-root` | Hors du dossier choisi |
| `duplicate-content` | Contenu identique |
| `unreadable` | Illisible |
| `empty` | Fichier vide |
| `derived-index` | Index généré |
| `transcript` | Transcription de conversation (importée en entier) |
| `session-summary` | Résumé de session |
| `session-artifact` | Sortie d'outil enregistrée avec une session |
| `persona` | Persona d'agent |
| `slash-command` | Commande slash |
| `cursor-rule` | Fichier de règles Cursor |
| `memory-note` | Note de mémoire |
| `memory-index` | Index de mémoire |
| `skill-package` | Paquet de compétence |
| `skill` | Fichier de compétence |
| `orphan-asset` | Fichier joint d'une compétence non importée |
| `rules-file` | Fichier de règles |
| `config` | Fichier de configuration |
| `source-code` | Fichier de code source — importable, non coché |
| `data-file` | Texte de données ou de configuration — importable, non coché |
| `symlink-upload` | Lien symbolique dans l'envoi |
| `needs-bun` | Nécessite le runtime Bun |
| `not-downloaded` | Stocké dans le cloud, non téléchargé — listé d’après ce que le système de fichiers sait, jamais récupéré |
| `invalid-json` | JSON invalide |
| `unknown-json` | JSON non reconnu |
| `unrecognised` | Non reconnu |
| `app-state` | État de l'application |
| `identity` | Fichier d'identité |
| `not-durable` | Texte tiers ou passe-partout — étiquette seulement |
| `tools-policy` | Politique d'outils |
| `not-importable` | Rien d'importable dedans |
| `missing-unit` | Sa partie du fichier a disparu |
| `unsupported-target` | Destination non prise en charge |
| `service-unavailable` | Le service n'était pas disponible |
| `not-a-persona` | Pas une persona d'agent |
| `no-agent` | Aucun agent pour le recevoir |
| `exceeds-string-limit` | Plus grand qu'une valeur texte que le moteur peut tenir — listé, pas encore classé |
| `unchanged` | Déjà importé, inchangé |
| `error` | Échec avec une erreur |

`not-durable` et `transcript` ne sont que des étiquettes : aucune ne décoche quoi que ce soit. Le genre **Inconnu** n’est plus produit — il ne survit que sur les scans faits avant cette version.

## Voir aussi

- [Mémoire](/docs/fr/knowledge/memory/)
- [Compétences](/docs/fr/automation/skills/)
- [Sauvegarde](/docs/fr/admin/backup/)
- [Agents — workspace](/docs/fr/agents/identity-workspace/)
