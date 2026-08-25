---
title: Recherche
description: Recherche hybride unifiée, sources de code multi-version et citations.
---

## Recherche globale (barre supérieure / page de résultats)

| Commande | Signification |
|----------|---------------|
| **Rechercher dans toutes les sources indexées…** | Zone de requête (aussi dans la barre de recherche du shell) |
| Liste de résultats | Occurrences sur le tableau, la mémoire, les documents, le code, … |
| **Aucun résultat pour « … »** | Ensemble de résultats vide |
| **Saisissez pour rechercher…** | Indication de requête vide |
| Pied de page **N résultats dans M fichiers** | Compteurs agrégés |
| **Sélectionnez un résultat pour afficher le fichier** | État vide du volet d’aperçu |
| **N lignes** | Taille de l’aperçu d’un fichier trouvé |

---

## Recherche hybride (comment fonctionne la recherche)

EYAS fusionne le **plein texte (FTS / Orama)** avec un index vectoriel **en mémoire** (cosinus) via **RRF** (fusion de rangs réciproques) et des poids adaptatifs à la requête. Lorsque les plongements sont indisponibles, la recherche **se dégrade en FTS uniquement** (repli honnête — pas de résultats vides silencieux).

| Fonction | Signification |
|----------|---------------|
| **Plongement à l’indexation** | Les segments stockent des plongements lorsqu’un fournisseur d’embedding (Ollama / OpenAI, …) est configuré ; les vecteurs se rechargent au démarrage |
| **Réutilisation par empreinte de contenu** | La réindexation réutilise les plongements lorsque le contenu du segment est inchangé |
| **Citations** | Les résultats `search_indexed` destinés aux agents incluent un `citationId` / `cite` stables (`[source:…]`) afin que les réponses puissent citer les sources |
| **list_search_sources** | Outil permettant aux agents de lister les sources configurées avant d’inventer des faits |
| **Ancrage** | Le critique de complétude attend des preuves de recherche pour les objectifs de recherche / implémentation à partir des sources — les agents doivent rechercher avant d’affirmer des faits |

Ajoutez des bases de code et des documents sous Sources de recherche afin que les agents ancrent le travail dans **votre** matière plutôt que de deviner.

---

## Sources de recherche

**Route :** `/search-sources` (Paramètres → Sources de recherche).  
Sous-titre : *Gérer les sources indexées pour la recherche sémantique et en plein texte.*

**Bonne pratique pour Odoo multi-version :** enregistrez **une source par dépôt** (p. ex. Community 18, Enterprise 18, modules personnalisés). Ne versez pas plusieurs versions d’Odoo dans une seule liste de chemins.

| Champ / commande | Signification |
|------------------|---------------|
| Compteurs **sources / segments / collections** | Statistiques d’index |
| **Ajouter une source** / **Nouvelle source** | Formulaire de création |
| **Nom** | Nom affiché (p. ex. `Odoo 18 Community`) |
| **Type** | Nature de la source (`code`, système de fichiers, …) |
| **Indexeur** | Pipeline (`code` pour les arborescences sources) |
| **Chemins / URL (un par ligne)** | Préférez **une racine absolue** par source |
| **Libellé** | Court identifiant d’épingle multi-version (p. ex. `18c`, `18e`, `eyssen-erp`) |
| **Version** | Chaîne de version libre (p. ex. `18`, `19`) |
| **Édition** | Édition libre (p. ex. `community`, `enterprise`) |
| **Famille** | Utilisez **`odoo`** pour les dépôts Odoo afin que la sécurité d’épinglage multi-version s’applique |
| **Répertoires / motifs exclus** | Ignorer le bruit (`i18n`, `static`, `node_modules`, …). La famille `odoo` reçoit des défauts raisonnables si vide |
| **Créer la source** | Persister (statut **inactif** jusqu’à réindexation) |
| **Dernière indexation** | Horodatage de la dernière indexation réussie |
| **Réindexer** | Parcourir par **lots de fichiers** (le serveur reste réactif). Les fichiers inchangés sont ignorés selon mtime ; les plongements réutilisent les empreintes de contenu. Le nombre de segments se met à jour en direct tant que le statut est **indexation**. Les exécutions interrompues reprennent au prochain Réindexer. |
| **Supprimer la source** | Retirer la source et ses segments |

Les badges de la liste affichent **libellé**, **version**, **édition**, **famille** et le statut.

### Statut d’index

| Statut | Signification |
|--------|---------------|
| **inactif** | Pas en cours / pas encore indexé |
| **indexation** | Parcours / plongement en cours — le nombre de segments augmente à mesure que les lots persistent |
| **prêt** | Interrogeable |
| **erreur** | La dernière indexation a échoué — vérifier les journaux / chemins |

### Amorçage par variables d’environnement (facultatif)

| Env | Signification |
|-----|---------------|
| `EYAS_ODOO_SOURCES_JSON` | Préféré : tableau JSON de `{ path, label?, version?, edition?, family?, name?, tags? }` — crée des sources nommées **inactives** au démarrage si elles manquent |
| `EYAS_ODOO_SOURCE_PATHS` | Racines séparées par deux-points ou points-virgules ; utilisées pour `odoo_search_*` léger et pour l’amorçage lorsqu’aucune source étiquetée n’existe encore |

Après l’amorçage, ouvrez Sources de recherche et **Réindexer** chaque source.

---

## Épinglage multi-version (quelle arborescence l’agent peut-il utiliser ?) {#multi-version-pin-which-tree-may-the-agent-use}

Lorsque plusieurs sources de **famille odoo** sont **prêtes**, EYAS **ne mélange pas** silencieusement les versions. Ordre de résolution :

1. **Arguments d’outil explicites** (`sourceIds`, `labels`, `version`, `edition` sur `search_indexed` / `odoo_search_*`)
2. **Épingle de conversation** — Rail de contexte → onglet **Sources** (cases)
3. **Défaut du projet** — Projets → **Sources de code par défaut**
4. **Type de projet** `indexed_sources` (si défini)
5. **Repli** — si un conflit multi-version demeure, les outils renvoient **`needsPin`** et listent les libellés disponibles

### Conversation → onglet Sources

Sur une conversation ouverte, **rail de contexte** à droite :

**Historique | Sources | Suite | Fichiers**

| Commande | Signification |
|----------|---------------|
| Liste des sources | Toutes les sources de recherche (nom, libellé, version, statut, chemin, nombre de segments) |
| Cases | Sélection multiple des sources que cette conversation peut utiliser |
| **Tout sélectionner** / **Effacer (auto)** | Épinglage / effacement en masse |
| Badge **Auto** | Pas d’épingle — défaut du projet / logique needsPin |
| **N épinglée(s)** | Nombre d’épingles actives |
| **Gérer les sources de recherche →** | Lien vers `/search-sources` |

L’enregistrement met à jour `searchContext: { sourceIds: […] }` sur la conversation. Les agents appellent `get_search_context` / `set_search_context` pour la même épingle.

### Défauts de projet

Sous **Projets** → modifier le projet → **Sources de code par défaut** :

| Commande | Signification |
|----------|---------------|
| Cases | Sources de recherche à épingler par défaut pour ce projet |
| **N sélectionnée(s)** / **Effacer** | Résumé et réinitialisation |

Appliqué automatiquement lorsque :

- Vous **créez une conversation** dans ce projet (Tableau ou nouveau chat avec projet)
- Vous **changez** le champ **Projet** d’une conversation (sauf si vous envoyez un `searchContext` explicite dans la même mise à jour)

Vous pouvez toujours surcharger par conversation dans l’onglet **Sources**.

### Outils d’agent

| Outil | Rôle |
|-------|------|
| `list_search_sources` | Lister les sources (libellé, version, famille, chemins, statut) |
| `get_search_context` | Épingle active pour cette conversation |
| `set_search_context` | Épingler / effacer (`labels`, `sourceIds`, `version`, `edition`, ou `clear: true`) |
| `search_indexed` | Recherche hybride — respecte l’épingle ; les filtres facultatifs surchargent |
| `odoo_search_model` / `field` / `xml_id` | Balayage Odoo local sur les **racines épinglées** uniquement ; cite `[source:odoo-src:label:file:line]` |

---

## Voir aussi

- [Conversations — onglet Sources](/docs/fr/daily/conversations/#context-rail-chatter)
- [Projets — sources de code par défaut](/docs/fr/daily/projects/#projects)
- [Configuration — env](/docs/fr/deploy/configuration/)
- [Outils — recherche et Odoo](/docs/fr/automation/tools/)
- [Élément de configuration Accueil : Répertoires à indexer](/docs/fr/daily/dashboard/)
