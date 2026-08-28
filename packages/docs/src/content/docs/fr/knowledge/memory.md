---
title: Mémoire
description: Mémoire hybride à cinq niveaux — chaque onglet et chaque champ.
---

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

Deux champs de frontmatter pilotent cela :

| Champ | Rôle |
|-------|------|
| `kind` | `user`, `feedback`, `project` ou `reference` — et l'ordre de tri |
| `summary` | La ligne unique affichée dans l'index |

`user` et `feedback` passent en premier, car ils changent la façon dont chaque
réponse est produite. Sans `kind`, une note dans `procedural/` est lue comme
`feedback`, les autres comme `reference` — jamais comme `user` : déclarer
d'office qu'une note parle de vous reviendrait à la placer en tête de chaque
prompt. Sans `summary`, la première vraie ligne sert d'index, donc un fichier
écrit à la main fonctionne sans frontmatter propre à EYAS.

Emplacement : `data/vault/semantic/`, `data/vault/procedural/`,
`data/vault/projects/`.

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
disque, et non à la relecture.

**Mémoire de projet.** Un fait appris dans les conversations d'un projet est
rangé sous `projects/<id-du-projet>/`, passe devant les notes `reference`
générales tant que vous travaillez dans ce projet, et n'apparaît nulle part
ailleurs : les notes d'un autre projet n'atteignent jamais votre prompt. Le
projet fourre-tout **General**, dans lequel démarre chaque conversation, ne
compte pas comme une identité de projet : ce qui y est appris reste un fait sur
vous ou sur la façon de travailler, et vous suit donc partout.

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
- [Import de données](/docs/fr/admin/data-port/)
- [Outils](/docs/fr/automation/tools/)
