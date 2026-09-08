---
title: Mémoire
description: Ce dont EYAS se souvient — notes de coffre automatiques, cinq niveaux, l’enregistrement brut de chaque message, et quel magasin utiliser.
---

**À quoi ça sert.** La mémoire est le magasin long terme d’EYAS. Un fait durable énoncé dans une conversation devient une note de coffre sans que personne le demande, et la même note est ce que relisent les conversations suivantes. Cette page sert à inspecter les blocs working, les faits épisodiques, les fichiers du coffre et la file de revue — pas à curer un wiki. Depuis la 0.8.23, EYAS conserve aussi un enregistrement brut de chaque message qu’il persiste ; celui-ci est écrit mais n’est encore lisible nulle part, et **L’enregistrement brut** ci-dessous dit tout ce qu’il y a à en savoir.

## Quand l’utiliser

- L’assistant doit se souvenir de qui vous êtes, comment vous travaillez, ou des contraintes d’un projet.
- Un fait a été dit dans le chat et vous voulez confirmer qu’il a atterri dans le coffre (ou pourquoi le capture a sauté).
- Revoir, taguer, grapher ou consolider — ou **Today's note**.
- Vous choisissez entre Mémoire, wiki Connaissances, Documents et fichiers de coffre écrits à la main (ci-dessous).
- Couper le capture pour cette instance (`memory.capture.enabled: false`) — ou couper aussi l’enregistrement brut (`memory.l0.enabled: false`).

## Déroulement typique

1. Ouvrez **Mémoire** dans la barre latérale (**Contenu**) — route `/memory`. (Aussi sous **Paramètres → IA et modèle**.)
2. Vérifiez **Overview**, puis **Vault Files** pour les notes durables.
3. Ayez une conversation de plus de ~40 caractères qui énonce un fait durable. Revenez ici après la réponse : une nouvelle note (`user`, `feedback`, `domain`, `project` ou `reference`).
4. Si rien n’apparaît : trop court, capture off, ou tour God Mode (ceux-là n’écrivent aucune note de coffre). Écrivez la note à la main dans le coffre si vous en avez quand même besoin. Un tour God Mode laisse tout de même la réponse gagnante dans l’enregistrement brut — voir **L’enregistrement brut** ci-dessous.

## Quel magasin utiliser

| Magasin | Métier |
|---------|--------|
| **Mémoire** (cette page) | Faits automatiques + écrits par l’agent. EYAS injecte un index d’une ligne dans les prompts suivants. |
| **Connaissances** wiki | Pages que **vous** éditez. Le capture n’écrit pas ici. |
| **Documents** | Fichiers téléversés pour retrieval — pas des notes d’identité. |
| **Fichiers de coffre** (markdown à la main) | Le même coffre que le capture (`data/vault/…`). Pas `~/.claude` / `~/.grok`. |
| **Wiki du projet** | Pages ticket et décision d’un projet, pas la mémoire globale. |
| **Enregistrement brut** | Chaque message qu’EYAS persiste, conservé une seconde fois mot pour mot et compressé. Écrit automatiquement depuis la 0.8.23 ; rien ne le lit ni ne l’affiche encore. |

La mémoire hôte Claude / Grok sur la machine **n’est pas** la source de vérité. Les appels CLI isolés et `loadClaudeMd` off par défaut empêchent une seconde mémoire de précéder le coffre.

## Fonctions

**Itinéraire :** `/memory`. Sous-titre : *Mémoire hybride à 5 niveaux — travail, épisodique, coffre sémantique/procédural, archive.*

## Actions

| Commande | Signification |
|----------|---------------|
| **Note du jour** | Aller à / créer la note du jour |
| **Consolider maintenant** | Lancer le consolidateur (promouvoir/rétrograder les mémoires) |
| **Actualiser** | Recharger les statistiques |

## Onglets

| Onglet | Contenu |
|--------|---------|
| **Aperçu** | Statistiques + graphiques de saillance + épisodiques récentes |
| **Mémoire de travail** | Blocs à TTL court (24 h) |
| **Mémoire épisodique** | Faits/épisodes avec saillance |
| **Fichiers du coffre** | Explorateur du coffre Markdown |
| **Archive** | Éléments archivés à faible saillance |
| **Graphe** | Vue graphe de la mémoire |
| **Étiquettes** | Explorateur d'étiquettes |
| **Révision** | File de révision pour l'hygiène de la mémoire |

## Statistiques de l'aperçu

| Statistique | Signification |
|-------------|---------------|
| **Blocs de travail** | Blocs de travail actifs (TTL 24 h) |
| **Faits épisodiques** | Nombre épisodique (+ invalidés) |
| **Fichiers du coffre** | Fichiers Markdown sémantiques + procéduraux |
| **Archivés** | Nombre d'archives à faible saillance |
| Prêts pour la promotion → coffre | Candidats épisodiques de grande valeur |
| Prêts pour la rétrogradation → archive | Candidats à faible saillance |
| Saillance min./moy./max. | Distribution |
| Étiquettes principales / par source | Répartitions |

## Ligne de mémoire de travail

caractères · consulté N× · expire à

## Ligne / détail épisodique

| Champ | Signification |
|-------|---------------|
| **saillance** | Score d'importance |
| **invalidée** | Plus fiable/à jour |
| **ID / Source / ID de source / Agent** | Provenance |
| **Nombre d'accès / Nombre de conversations** | Utilisation |
| **Valide depuis / Invalidée le / Créée / Dernier accès** | Horodatages du cycle de vie |
| **Hash d'embedding** | Présence dans l'index vectoriel |

## Explorateur du coffre

| Commande | Signification |
|----------|---------------|
| Liste de fichiers | Chemins du coffre |
| **Frontmatter** | Métadonnées YAML |
| **étiquettes / liens** | Wikiliens et étiquettes |
| **Contenu** | Corps Markdown |
| **Rétroliens** | Notes qui pointent ici |

## Archive

archivée le · originale créée le · identifiants — le consolidateur y déplace les éléments à faible saillance.

## Notes durables

Une note durable est un fait qui persiste, pas le compte rendu d'un événement :
qui vous êtes, comment vous voulez qu'on travaille, quelles sont les
contraintes d'un projet. Chacune est un fichier markdown dans le vault, et
l'agent reçoit à chaque tour un **index d'une ligne** — les résumés seulement.
Il lit une note entière avec `search_memory` quand la ligne s'avère utile.

Un second bloc par tour récupère le **travail antérieur lié** depuis le vault,
la mémoire épisodique et les messages de conversations passées, en prenant le
message actuel comme requête. Le modèle n'a pas à appeler `search_memory` pour
que ces résultats apparaissent. Les corps se chargent toujours via
`search_memory`. Les messages passés sont interrogeables parce qu'ils sont
déjà stockés — ce bloc n'en fait aucune copie supplémentaire. (L'enregistrement
brut ci-dessous est une seconde copie distincte et délibérée ; rien ne le lit
encore.)

Deux champs de frontmatter pilotent cela :

| Champ | Rôle |
|-------|------|
| `kind` | `user`, `feedback`, `domain`, `project` ou `reference` — et l'ordre de tri |
| `summary` | La ligne unique affichée dans l'index |

`user` et `feedback` passent en premier, car ils changent la façon dont chaque
réponse est produite. `domain` est le type de projet (partagé entre projets
frères) ; `project` est ce client. Sans `kind`, une note dans `procedural/` est lue comme
`feedback`, les autres comme `reference` — jamais comme `user` : déclarer
d'office qu'une note parle de vous reviendrait à la placer en tête de chaque
prompt. Sans `summary`, la première vraie ligne sert d'index, donc un fichier
écrit à la main fonctionne sans frontmatter propre à EYAS.

Emplacement : `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`, `data/vault/project-types/`.

**Elles se remplissent d'elles-mêmes.** Une fois la réponse délivrée, un appel à
un petit modèle relit l'échange et se demande s'il s'y trouve quelque chose qui
sera encore vrai et encore utile dans un mois. Deux notes au plus par tour, et
sur la plupart des tours, à juste titre, aucune. Cela ne se produit jamais dans
le chemin critique de votre réponse : une capture qui échoue coûte une note,
jamais une réponse.

Devant cet appel, une seule vérification de longueur — un message plus court que
`minUserChars` (40 caractères par défaut) ne le déclenche pas — et un plafond de
`maxPerConversation` (20) appels par conversation. Aucune liste de mots-clés,
dans aucune langue. Tout se coupe avec `memory.capture.enabled: false` dans
`config/default.yaml` ; écrire une note à la main et appeler `save_memory`
fonctionnent toujours à l'identique.

Un fait répété renforce la note qui existe déjà au lieu d'en créer une seconde :
la nouvelle formulation s'ajoute en puce datée sous `## History` et n'écrase
rien. Le texte traverse le module de confidentialité avant d'atteindre le
disque, et non à la relecture. Cela vaut pour les notes du vault ;
l'enregistrement brut ci-dessous est stocké tel quel, sans ce passage.

**Mémoire de projet.** Un fait appris dans les conversations d'un projet est
rangé sous `projects/<id-du-projet>/`, passe devant les notes `reference`
générales tant que vous travaillez dans ce projet, et n'apparaît nulle part
ailleurs : les notes d'un autre projet n'atteignent jamais votre prompt. Le
projet fourre-tout **General**, dans lequel démarre chaque conversation, ne
compte pas comme une identité de projet : ce qui y est appris reste un fait sur
vous ou sur la façon de travailler, et vous suit donc partout.

Les agents se souviennent avec `search_memory`. Le **`scope` par défaut est `current`** : ce projet, son type, et les notes globales user / feedback / reference. `scope: all` pour tout le coffre. La recherche de la page Mémoire (`/memory`) n’est pas filtrée.

### Notes de projet sans projet

Une note dont le `kind` est `project` ou `domain` mais qui ne porte aucun
`project:` / `projectType:` est **globale** : elle figure dans l’index permanent,
dans `search_memory` et dans le travail lié de chaque conversation, classée comme
note de projet. La déplacer dans `projects/<id>/` — ou inscrire `project:` dans
son frontmatter — la restreint à ce projet. Les notes apportées par un import
restent ainsi tant que vous n’avez pas créé les projets correspondants.

L’index permanent a un budget de caractères : `memory.index.budgetChars`, 2400
par défaut. Augmentez-le quand vos lignes `user` et `feedback` n’y tiennent plus.

### Les secrets importés restent hors du rappel

L’importateur n’écarte jamais un fichier parce qu’il contient un identifiant.
Il est stocké tel quel et l’élément porte le tag `contains-secrets` — comme tag
de note, capacité de compétence ou tag épisodique, selon ce qu’il est devenu.

Par défaut, un tel élément reste en dehors de tout ce que le modèle atteint de
lui-même : l’index permanent, `search_memory`, le travail connexe, la tâche de
réflexion, le consolidateur nocturne et l’appariement des compétences. Il n’est
jamais vectorisé ni remis au modèle d’enrichissement facultatif. La page
Mémoire vous le montre toujours en entier. Mettre
`memory.recall.includeSecrets: true` dans `config/local.yaml` puis redémarrer
l’ouvre au modèle.

Cette porte empêche l’inclusion automatique ; ce n’est pas un bac à sable du
système de fichiers. Un agent doté d’outils de lecture de fichiers peut
toujours lire le fichier d’origine sur le disque. Une persona d’agent importée
et un fichier de règles de workspace approuvé ne sont pas filtrés du tout — là,
le contenu *est* le prompt — relisez donc ces lignes avant de les approuver.

Les tags `legacy` (un ancien dossier de mémoire) et `third-party` (de la
documentation produit tierce) désignent des notes ordinaires, pleinement
rappelables ; ils disent seulement d’où vient une note. Chaque élément importé
porte aussi `source:<adaptateur>`, qui nomme l’adaptateur l’ayant lu. Une note
que vous écrivez vous-même peut déclarer `contains-secrets` dans son propre
frontmatter et reçoit le même traitement. Voir
[Import et export de données](/docs/fr/admin/data-port/).

### Le capture est activé par défaut

Le capture tourne sur **chaque** conversation, globalement, sauf `memory.capture.enabled: false` dans `config/default.yaml`. Un petit appel modèle s’accroche **après** la livraison de la réponse. Un capture raté est une note manquante, jamais une conversation ratée.

| Porte | Défaut | Signification |
|-------|--------|---------------|
| `memory.capture.enabled` | **on** | Interrupteur maître |
| `minUserChars` | 40 | Points de code Unicode |
| `maxPerConversation` | 20 | Plafond de dépense modèle |

Pas de liste de mots-clés. `{"notes":[]}` est la réponse fréquente et correcte (0–2 notes).

### CLI isolé — mémoire EYAS seulement

L’extraction tourne dans un contexte modèle **isolé** : pas de settings filesystem hôte, pas de mémoire native CLI, pas d’outils bridgés, un seul tour. Les conversations Claude Code CLI ont **`loadClaudeMd` off** par défaut. Les appels isolés et opt-out posent aussi `CLAUDE_CODE_DISABLE_AUTO_MEMORY` et `strictMcpConfig`.

Grok / Kimi (ACP) n’ont pas d’interrupteur d’isolation ; leurs panneaux le disent. Les agents doivent n’utiliser que `search_memory` / `save_memory` ; la porte d’écriture refuse `~/.claude`, `~/.grok` et `ai-memory`.

Sans isolation, l’extracteur a lu une fois la mémoire hôte du propriétaire, a dit le fait « déjà enregistré », et le coffre EYAS est resté vide. C’est le bug que ceci ferme.

### Journal des captures

Chaque résultat qui atteint la porte écrit une ligne `memory_capture_runs`. Deux silences : capture off n’écrit rien ; un run d’arrière-plan sans texte assistant n’atteint pas la porte. Les tours **God Mode** rendent leur propre flux avant le bloc post-tour : ils n’écrivent donc ni note de coffre, ni ligne ici. L’enregistrement brut ci-dessous est un journal distinct, et celui-là les couvre.

---

## L’enregistrement brut

**Rien de ce qui est dit ne se perd.** Chaque message qu’EYAS consigne — les
vôtres, ceux de l’assistant et la sortie des runs d’agent en arrière-plan — est
désormais conservé une seconde fois, mot pour mot, dans un enregistrement brut
placé à côté de la conversation elle-même. Il est compressé à l’entrée (environ
2,7× plus petit sur du texte réel) et rangé sous l’empreinte de ses propres
octets : une même phrase répétée dans une conversation est donc stockée une
fois et comptée deux fois.

**À lire avant tout le reste : vous ne pouvez encore rien en voir.** Cette
version ne fait que démarrer l’enregistrement. Aucune page, aucun champ de
recherche et aucune commande ne relit l’enregistrement brut, et rien de tout
cela n’est présenté à l’assistant. Ce qui atteint vos prompts aujourd’hui est
exactement ce qui les atteignait avant : l’index d’une ligne du coffre et le
bloc de travail antérieur lié décrits plus haut. Le rappel viendra dans une
version ultérieure.

Ce qui change pour vous aujourd’hui, c’est l’endroit où vivent vos mots. Une
conversation n’est plus la seule copie de ce qui s’y est dit : la fermer,
l’archiver ou la supprimer laisse l’enregistrement brut en place, et aucun
bouton nulle part ne l’efface. Si ce n’est pas ce que vous voulez, coupez
l’enregistrement brut avant d’utiliser EYAS pour quoi que ce soit dont vous
voudriez plus tard qu’il ait disparu (voir ci-dessous).

L’écriture se fait par lots, pas immédiatement. Les messages sont retenus par
conversation, puis écrits quand la conversation se ferme (ou passe dans une
étape fermée), quand environ 8 000 tokens se sont accumulés, quand la
conversation est restée inactive 30 minutes, ou quand EYAS s’arrête — un
redémarrage ne perd rien de ce qui avait déjà été dit.

Chaque message est en outre estampillé de son origine, et cette estampille ne
s’hérite jamais : ce que **vous** écrivez est de niveau propriétaire, ce que le
modèle écrit n’en est que dérivé, et la sortie d’outil vient d’ailleurs. Un
résumé ne peut donc jamais finir plus digne de confiance que les mots dont il
est tiré.

### Ce qu’EYAS en déduit — sans aucun appel modèle

À chaque lot écrit, EYAS relit ce qu’il vient d’écrire et en déduit, tout seul :

- des **faits**, à partir des lignes `key: value` du texte, plus quelques-uns
  tirés de la carte de Tableau de la conversation elle-même (titre, projet, type
  de projet, agent) ;
- **un résumé court**, de 280 caractères au plus — le premier et le dernier
  message, plus quelques-unes des phrases les plus caractéristiques entre les
  deux ;
- des **entités** : dates, `@mentions`, `#tickets`, identifiants de code, termes
  entre accents graves, noms à majuscule initiale ;
- des **thèmes**, et un **score d’importance** construit sur la longueur de la
  conversation, la part qui vous revient, la présence de formulations de
  décision (en cinq langues), le fait qu’elle soit fermée et le fait que vous
  l’ayez épinglée.

Rien de tout cela n’appelle un modèle. Aucun fournisseur n’est contacté, aucune
clé API n’est utilisée, aucun budget n’est dépensé, et il n’y a rien à
configurer. La contrepartie, c’est que la lecture est appliquée plutôt que
maligne : elle trouve ce qui a été dit clairement et manque ce qui n’était que
sous-entendu.

Les faits ne s’empilent pas. Redire la même chose renvoie au fait qui existe
déjà. Dire du neuf sur le même sujet — une échéance qui passe du lundi au
vendredi — retire l’ancien fait avec une date de fin au lieu de l’écraser : il y
a donc exactement une réponse courante, et un historique intact derrière elle.
Rien n’est modifié sur place et rien n’est jeté. Un fait n’hérite pas non plus
d’une étiquette de projet ou de conversation que toutes ses sources ne portent
pas.

Comme plus haut : rien de tout cela n’est encore lisible non plus.

### Ce que ça vous coûte, et comment le couper

L’enregistrement brut grossit avec l’usage, et **rien ne l’élague encore** — ni
réglage de rétention, ni tâche de nettoyage dans cette version. Mesuré, un
message enregistré coûte de l’ordre de 5 Ko sur le disque une fois ses index
comptés : attendez-vous donc à voir la base grossir nettement plus vite qu’avant.

Trois réglages dans `config/default.yaml`, tous sous `memory` :

| Réglage | Défaut | Signification |
|---------|--------|---------------|
| `memory.l0.enabled` | **on** | Interrupteur maître. `false` n’enregistre plus rien ; effectif au redémarrage suivant |
| `memory.l0.extractInLegacy` | **on** | `false` garde le texte et n’en déduit rien — ni faits, ni résumés, ni thèmes |
| `memory.engine` | `legacy` | Quel moteur sert la mémoire. Le passer à `v2` ne change rien d’observable aujourd’hui |

`memory.capture.enabled: false` ne coupe **pas** l’enregistrement brut. Ce
réglage-là gouverne les notes de coffre et le petit appel modèle qui les
produit ; les deux sont indépendants, et couper l’un laisse l’autre tourner.

`eyas doctor` indique si la compression est disponible et quelle implémentation
est utilisée. S’il n’y en a aucune, EYAS le dit dans le log et n’enregistre
rien, plutôt que de remplir un tampon en silence.

### Les résultats d’outil ne sont pas enregistrés — et pourquoi en rester là

`memory.l0.captureToolResults` est **off par défaut**. Lisez ceci avant de
l’activer.

Une fois activé, l’enregistrement brut garde **la sortie entière de chaque appel
d’outil, mot pour mot et sans retouche**, plus les 2 048 premiers caractères des
arguments de l’appel. Autrement dit : la sortie complète d’une commande, le
contenu de chaque fichier que l’assistant lit, et tout code à usage unique ou
jeton qu’un outil viendrait à renvoyer — le tout posé dans la base comme du
texte ordinaire. Rien ne le masque, rien ne l’analyse, et la compression n’est
pas du chiffrement. Les notes de coffre traversent le module de confidentialité
avant d’être écrites ; les résultats d’outil enregistrés, non.

Chaque résultat enregistré est plafonné à `memory.l0.toolResultMaxBytes` (8 Ko)
et coupé sur une frontière de caractère, avec un marqueur de troncature visible.
Le drapeau activé, EYAS affiche à chaque démarrage un avertissement qui dit
exactement cela.

### Pourquoi certaines phrases sont refusées

Un texte qui se lit comme une instruction adressée à l’assistant n’a pas le
droit de devenir un fait de confiance. « Ignore toutes les instructions
précédentes », un changement de rôle « à partir de maintenant, tu es… », ou tout
ce qui est déguisé en message système, est refusé net. Les ordres simples visant
l’assistant, les injonctions à lancer un outil et les formulations du type
« oublie tout » sont conservés, mais marqués non fiables, pour qu’un rappel
ultérieur puisse les écarter. Le contrôle couvre l’anglais, le hongrois,
l’allemand, l’espagnol et le français.

Quand un résumé est refusé, EYAS redescend d’un cran plutôt que de renoncer :
d’abord un résumé plus sobre, puis les seules phrases qui se lisent proprement,
et en dernier un talon qui nomme la conversation sans en répéter le texte. Vous
ne perdez jamais la conversation, seulement son résumé.

C’est un filtre à motifs, pas une preuve, et il penche du côté de la prudence :
de la prose de travail ordinaire comme `Run the following command in the pod: …`
se retrouve parfois marquée non fiable elle aussi. Comme rien ne lit encore ces
couches, le seul effet aujourd’hui est un nombre dans le journal des runs.

---

## Blocs de mémoire partagés (outils d'agent)

Outre l'interface à cinq niveaux, les agents peuvent utiliser des **blocs de mémoire à portée** (style Letta) via des outils — notes partagées durables pour le travail multi-tours et multi-agents.

| Portée | Partagé entre |
|--------|---------------|
| **company** | Toute l'instance |
| **agent** | Un agent |
| **team** | Orchestration d'équipe |
| **run** | Un seul run |

| Outil | Signification |
|-------|---------------|
| `memory_block_read` | Lire le contenu du bloc |
| `memory_block_write` | Ajouter ou remplacer le contenu ; formaté dans les prompts lorsque c'est pertinent |

Ces blocs sont distincts des lignes de mémoire de travail de cette page, mais les complètent pour l'état inter-conversations.

## Voir aussi

- [Base de connaissances](/docs/fr/knowledge/knowledge-base/)
- [Documents](/docs/fr/knowledge/documents/)
- [Wiki du projet](/docs/fr/knowledge/client-wiki/)
- [Fournisseurs](/docs/fr/ai/providers/) (isolation CLI / `loadClaudeMd`)
- [Import de données](/docs/fr/admin/data-port/)
- [Configuration](/docs/fr/deploy/configuration/) (clés `memory.l0.*`)
- [Outils](/docs/fr/automation/tools/)
