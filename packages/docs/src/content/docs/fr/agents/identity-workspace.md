---
title: Identité et espace de travail
description: Éditer IDENTITY, AGENTS, TOOLS et MEMORY — et restaurer un instantané si besoin.
---

**À quoi ça sert.** Les fichiers workspace sont la prose durable de l’agent : qui il est, comment il se relie à l’équipe, comment utiliser les outils, de quoi il se souvient. Plus profond que le formulaire Configuration. Si l’autonomie interdit l’auto-mise à jour, les changements d’identité passent par [Forge](/docs/fr/agents/forge/), pas par une réécriture silencieuse.

## Quand l’utiliser

- Écrire (ou restaurer) **Who I am**, **My mission**, règles d’escalade et de refus.
- Un guide sur l’équipe (`AGENTS`) ou la politique d’outils (`TOOLS`).
- Un mauvais edit — **History → Restore**.
- Comparer une proposition soul Forge à l’IDENTITY actuelle.

## Déroulement typique

1. Ouvrez **Agents** → l’agent → onglet **Espace de travail** — route `/agents/:id`.
2. Choisissez un fichier (**Who I am**, **Team description**, **Tools**, **Memory**). **Editor** ou **Preview**.
3. Les puces IDENTITY sautent aux (ou créent les) titres manquants. **Save**.
4. **History** si un instantané est besoin. Après restauration, le fichier sur disque doit correspondre.

## Fonctions

**Chemin :** `/agents/:id` → onglet **Espace de travail**.

Le comportement durable vit dans des **fichiers markdown** sous `data/agents/<id>/`, pas seulement dans les champs de formulaire SQL.

## Sélecteur de fichier

| Libellé de fichier | Signification |
|--------------------|---------------|
| **Qui je suis** (`IDENTITY`) | Récit d'identité de base et sections de mission |
| **Description de l'équipe** (`AGENTS`) | Comment cet agent se situe par rapport à l'équipe |
| **Outils** (`TOOLS`) | Conseils d'utilisation des outils |
| **Mémoire** (`MEMORY`) | Notes / pointeurs de mémoire |

## Éditeur

| Commande | Signification |
|----------|---------------|
| **Éditeur** | Mode d'édition markdown brut |
| **Aperçu** | Aperçu rendu |
| **Contenu Markdown…** | Espace réservé de l'éditeur |
| **Enregistrer** | Écrire le fichier sur le disque / le magasin d'espace de travail |
| **(vide)** | Le fichier n'a pas encore de contenu |

## Assistant de sections IDENTITY

Cliquez une pastille de section pour y aller ou **créer** un titre manquant :

| Section | Objet |
|---------|-------|
| **Qui je suis** | Auto-description |
| **Ma mission** | Énoncé de mission |
| **Tâches proactives continues** | Devoirs en arrière-plan |
| **Quand escalader** | Règles d'escalade |
| **Quand refuser** | Frontières de refus strictes |

Indication : *Cliquez sur une section pour l'ajouter si elle manque.*

## Panneau Historique

| Commande | Signification |
|----------|---------------|
| **Historique** | Liste des instantanés enregistrés |
| **Voir** | Ouvrir la comparaison d'instantanés |
| **Instantané (date)** vs **Version actuelle** | Côtés du diff |
| **Restaurer** | Ramener le fichier à l'instantané |
| Vide | *Aucun historique enregistré.* |

L'avis d'instantané peut indiquer de restaurer puis d'ouvrir dans l'éditeur pour voir le contenu complet.

## Lien avec Configuration et Forge

| Chemin | Ce qui change |
|--------|---------------|
| Formulaire Configuration | Nom, modèle, liste d'outils, budgets au niveau SQL |
| Fichiers d'espace de travail | Identité profonde, mission, politique d'outils en prose |
| [Forge](/docs/fr/agents/forge/) | Changements d'identité / d'âme proposés nécessitant une approbation |

Lorsque l'autonomie interdit l'auto-mise à jour directe de l'identité, les agents doivent proposer via Forge au lieu de réécrire IDENTITY eux-mêmes.

## Voir aussi

- [Créer et configurer](/docs/fr/agents/configure/)
- [Forge](/docs/fr/agents/forge/)
- [Autonomie](/docs/fr/agents/autonomy/)
