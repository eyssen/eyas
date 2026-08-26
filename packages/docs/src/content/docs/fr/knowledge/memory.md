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
