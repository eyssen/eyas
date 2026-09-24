---
title: Projets
description: Grouper les conversations en types, projets et étapes partagées — avec agent et sources de code par défaut.
---

**À quoi ça sert.** Les projets groupent les conversations. Un **type de projet** est le modèle ; un **projet** est l’instance (agent par défaut, prompt, sources de code) ; les **étapes** sont les colonnes kanban partagées. Les cartes du Tableau et les champs **Project** / **Stage** du chat sont cette structure.

## Quand l’utiliser

- Un nouveau corpus de travail avec son agent par défaut, ses dossiers de travail et éventuellement ses arbres de code.
- Un type réutilisable (priorité, icône, prompt, répertoires de travail) pour que les nouveaux projets démarrent pareil.
- Les conversations créées dans ce projet doivent hériter des sources indexées et des dossiers.
- Tickets fermés ou décisions d’équipe doivent aller sur le wiki du projet (opt-in).
- Une étape doit auto-assigner un agent à l’entrée d’une carte.

## Déroulement typique

1. Ouvrez **Paramètres → Projets** (barre latérale **Paramètres**, groupe **Modules**) — route `/projects`.
2. Créez un **Project Type** si un modèle est nécessaire (prompt, **Répertoires de travail** optionnels), puis **New Project** (nom, type, agent, **Répertoires de travail** optionnels, sources optionnelles, **Wiki auto-update** optionnel).
3. Sous **Stages**, ajoutez ou réordonnez les colonnes (**Closed**, **Folded**, **Bot**, **Auto-assign**).
4. Ouvrez **Tableau**, choisissez le projet — ces étapes sont les colonnes. Une nouvelle conversation hérite des sources et des dossiers. **Wiki** sur la carte ouvre `/projects/:projectId/wiki`.

## Fonctions

**Route :** `/projects` (aussi sous Paramètres → Projets).  
Sous-titre : *Gérer les types de projets, les projets et les flux d’étapes.*

Les projets regroupent les **conversations** en **étapes** avec des agents et prompts par défaut facultatifs.

## Onglets / sections

| Section | Rôle |
|---------|------|
| **Projets** | Instances concrètes de projets |
| **Types de projets** | Modèles pour les nouveaux projets |
| **Étapes** | Étapes de flux de travail globales (partagées) |

---

## Projets {#projects}

Intro : *Les projets organisent les conversations en étapes avec des flux personnalisés.*

| Champ / commande | Obligatoire | Signification |
|------------------|-------------|---------------|
| **Nouveau projet** | — | Ouvrir le formulaire de création |
| **Modifier le projet** | — | Modifier le projet sélectionné |
| **Nom** | Oui | Nom affiché du projet (p. ex. `EYAS v1.0`) |
| **Type** | Oui | Modèle de type de projet (`Sélectionner un type…`) |
| **Description** | Non | Courte description |
| **Couleur** | Non | Pastille de couleur d’interface |
| **Agent par défaut** | Oui | Agent assigné aux nouvelles conversations de ce projet |
| **Prompt** | Non | Prompt système supplémentaire. Vide hérite du type. Un `+` l’étend. Tout le reste le remplace. Le formulaire est ce que le modèle voit ; un enregistrement non vide écrit aussi `AGENTS.md`. |
| **Coach de prompt** | — | Coach IA pour le brief opérationnel du projet (domaine, conventions, critères de succès) — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |
| **Répertoires de travail** | Non | Racines nommées (nom + chemin absolu). Le premier est **Primaire**. Les nouvelles conversations héritent de cette liste. Une liste vide copie celle du **type**. Sans chemin, chaque conversation travaille dans son propre espace de travail EYAS ([Dossiers](/docs/fr/daily/conversations/#working-folders)). |
| **Sources de code par défaut** | Non | Sélection multiple de [sources de recherche](/docs/fr/daily/search/). Épinglées automatiquement sur les **nouvelles conversations** de ce projet et lorsqu’on définit le champ **Projet** d’une conversation sur ce projet |
| **Wiki auto-update** | Non | Désactivé par défaut. **Tickets fermés** et **Décisions d’équipe** séparément. Corps du ticket : **Titre seulement** / **Dernier tour** / **Conversation entière**. Le projet fourre-tout **General** ne reçoit jamais de pages. |
| **Wiki** | — | Wiki de ce projet |
| Badge **Agent** / **Aucun agent** | — | Si un agent par défaut est défini |
| Badge **N sources** | — | Combien de sources de code par défaut sont sélectionnées |

Vide : créez un projet pour organiser les conversations.

### Sources de code par défaut (multi-version)

1. Enregistrez les dépôts sous **Sources de recherche** (une source par version / arborescence Odoo, avec **Libellé** + **Famille : odoo**).
2. **Réindexer** jusqu’à ce que le statut soit **prêt**.
3. Sur le formulaire du projet, cochez les sources que ce projet doit utiliser par défaut.
4. Ouvrez une conversation dans le projet → l’onglet **Sources** du rail de droite affiche les mêmes épingles (vous pouvez encore les changer par fil).

Voir [Recherche — épinglage multi-version](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

<h3 id="working-directories">Répertoires de travail</h3>

Où les conversations de ce projet lisent et écrivent. Même forme sur le **type** (défauts des nouveaux projets) et le **projet** (remplace le type). Une conversation peut encore épingler le primaire.

Les chemins sont des données d’instance — jamais des défauts produit.

**Quels dossiers peuvent être enregistrés.** Le projet, le type de projet et les Dossiers de conversation partagent une seule vérification. L’enregistrement refuse un dossier en le nommant, avec la raison dans votre langue : la racine du système de fichiers, votre dossier personnel ou tout dossier au-dessus ; un dossier dans le stockage propre d’un autre outil d’IA (`~/.claude`, `~/.grok`, `~/.codex`, `~/.cursor`, …) ou dans les homes de connexion CLI d’EYAS ; un dossier dans un coffre Obsidian, un dossier `ai-memory` ou une entrée de `security.foreignMemoryPaths` ; un dossier dans le dossier de données propre à EYAS (sauf un espace de travail de conversation unique, les projets Studio et les téléchargements du navigateur) ; les emplacements sensibles (`.ssh`, `.env`, `master.key`, le dossier de la base de données) ; et un chemin relatif, un dossier inexistant ou un fichier. Un dossier est aussi refusé quand il **contient** un tel emplacement, et le message nomme ce qui a été trouvé à l’intérieur : le home propre d’EYAS, son dossier de données, sa base ou son dossier des espaces de travail (le checkout EYAS qui contient `data/`), le stockage d’un autre outil d’IA ou un dossier de connexion CLI d’EYAS, un coffre de notes, un dossier `ai-memory` ou une entrée de `security.foreignMemoryPaths` (`~/Documents` contenant un coffre). Une CLI lit et cherche dans son dossier de travail sans rien demander, un tel dossier n’est donc pas sûr à lui confier ; choisissez-en un plus restreint, comme le dossier du projet dans `~/Documents` ou un clone séparé du dépôt. La liste complète : [Conversations — Dossiers](/docs/fr/daily/conversations/#working-folders).

Chaque enregistrement vérifie toute la liste : retirez donc un dossier désormais refusé avant d’enregistrer d’autres modifications. Les dossiers enregistrés plus tôt et désormais refusés ne sont pas réécrits, mais chaque exécution les écarte — les outils de fichiers propres d’EYAS, le portail de sécurité et le dossier de travail de la CLI —, et le tour du chat affiche un avis qui nomme le dossier. Si tous les dossiers enregistrés sont refusés, les outils de fichiers propres d’EYAS n’ont aucun dossier, et une CLI travaille dans l’espace de travail EYAS propre à la conversation. Le formulaire **Types de projets** affiche désormais une erreur d’enregistrement dans le formulaire (avant, un échec d’enregistrement était silencieux). L’API répond à un dossier refusé sur `POST`/`PATCH /api/v1/projects` et `/api/v1/project-types` par `400 {error, code, path, found}` (`found` est l’emplacement protégé trouvé dans le dossier, pour les codes `containsEyasData`, `containsProviderHome` et `containsVault`) ; une valeur `workingDirectories` qui n’est pas une liste de chemins non vides (ou `null`) donne un `400` sans code, et `null` ou `[]` vide toujours la liste.

<h3 id="wiki-auto-update">Wiki auto-update</h3>

Désactivé par défaut. Activez **Tickets fermés** et/ou **Décisions d’équipe** sur ce projet seulement. Fermer une carte écrit `ticket-<id>` si les tickets sont on. Une session d’équipe avec findings/décisions écrit `decision-<id>` si les décisions sont on. Enregistrer une page wiki dans l’UI en prend possession. Détail : [Wiki projet](/docs/fr/knowledge/client-wiki/).

---

## Types de projets

Intro : *Modèles avec prompts et paramètres pour les nouveaux projets.*

| Champ / commande | Signification |
|------------------|---------------|
| **Nouveau / Modifier un type de projet** | CRUD du type |
| **Nom** | Nom du type (p. ex. Développement) |
| **Priorité par défaut** | Basse / Normale / Haute / Urgente pour les nouvelles conversations |
| **Icône** | Sélecteur d’icône ; **Effacer l’icône** la retire |
| **Prompt** | Prompt système appliqué aux projets de ce type (le brief réutilisable, sauf override projet) |
| **Coach de prompt** | Coach IA pour les défauts réutilisables de type de projet — [Prompts](/docs/fr/ai/prompts/#prompt-coach) |
| **Répertoires de travail** | Dossiers par défaut des nouveaux projets de ce type. Le premier chemin est primaire. Un projet avec sa propre liste remplace ceci. |
| **Couleur** | Couleur du type |

Les types d’amorçage incluent souvent **general** et **eyas** (liés aux agents principaux à la configuration).

---

## Étapes

Intro : *Étapes de flux de travail globales utilisées par tous les projets. Glissez pour réordonner.*

| Champ / commande | Signification |
|------------------|---------------|
| **Ajouter une étape** / **Nouvelle étape** | Créer une étape |
| **Nom** | Libellé d’étape (titre de colonne kanban) |
| **Fermé** | Étape finale — travail considéré comme terminé |
| **Replié** | Colonne repliée par défaut sur le Tableau |
| **Bot** (Écoute bot) | L’IA surveille cette étape |
| **Auto-assignation** | Agent qui reçoit les cartes entrant dans cette étape et peut s’exécuter de façon autonome (`Aucun` = désactivé) |

Infobulles : Fermé = final ; Replié = replié ; Écoute bot = l’IA surveille ; Auto-assignation = transfert + exécution autonome.

---

## Lien avec le Tableau et le chat

1. Créez un **type** (prompt, répertoires de travail optionnels) → créez un **projet** avec agent, répertoires de travail et sources de code facultatives  
2. Définissez les **étapes** (colonnes globales)  
3. Les conversations sur le **Tableau** se déplacent d’étape en étape  
4. Les champs **Projet** / **Étape** / **Dossiers de travail** reflètent cette structure  
5. L’onglet **Sources** hérite de l’épingle du projet ; **Dossiers** hérite de la liste des répertoires  
6. Activez **Wiki auto-update** si tickets fermés ou décisions d’équipe doivent atterrir sur `/projects/:projectId/wiki`

## Voir aussi

- [Tableau](/docs/fr/daily/board/)
- [Conversations](/docs/fr/daily/conversations/)
- [Sources de recherche](/docs/fr/daily/search/)
- [Wiki projet](/docs/fr/knowledge/client-wiki/)
- [Prompts](/docs/fr/ai/prompts/)
