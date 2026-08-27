---
title: Compétences
description: Catalogue de compétences — sources, filtres, champs du formulaire de création.
---

**Route :** `/skills`. Sous-titre : *Gérez les modèles de compétences, les motifs de déclenchement et les compétences générées.*

## Contrôles de la liste

| Contrôle | Signification |
|----------|---------------|
| **activées** | Nombre de compétences activées |
| **Créer une compétence** | Ouvrir le formulaire de création |
| Rechercher | *Rechercher par nom ou motif de déclenchement…* |
| Filtre **Toutes / Compétences propres / Intégrées** | Filtre de source |

## Sources / catégories

| Libellé | Signification |
|---------|---------------|
| **Intégrée** | Livrée avec EYAS |
| **Utilisateur** | Créée par vous dans l’interface |
| **Générée** | Produite par la génération / l’évolution de compétences |
| **Propres** | Catégorie « propres » importée ou suggérée par EYAS |

## Formulaire de création

| Champ | Signification |
|-------|---------------|
| **Nom de la compétence** | Nom affiché |
| **Motifs de déclenchement (séparés par des virgules)** | Quand la compétence est considérée pour activation |
| **Contenu / modèle de la compétence** | Corps Markdown chargé par l’agent |

## Actions de ligne

| Contrôle | Signification |
|----------|---------------|
| **Afficher le contenu / Masquer le contenu** | Développer le corps Markdown |

Vide : *Aucune compétence trouvée. Créez-en une pour commencer.*

---

## Compétences de codage intégrées (exemples)

| Chemin / domaine | Rôle |
|------------------|------|
| `coding/odoo/odoo-dev-chain` | Chaîne implémenter / revoir Odoo : ancrer avec `odoo_search_*` + outils fichier avant d’écrire des modules |

Les compétences se chargent comme des procédures Markdown ; les outils viennent toujours de la liste d’outils de l’agent ([Configurer](/docs/fr/agents/configure/), [Outils](/docs/fr/automation/tools/)).

## Porte d’adoption automatique (curateur de compétences)

Les compétences générées / évoluées **ne sont pas adoptées automatiquement** à moins qu’un instantané de benchmark privé récent atteigne les seuils minimaux de **taux de réussite** et de **score moyen**. Cela écarte les propositions de faible qualité du catalogue en production jusqu’à ce que la qualité d’évaluation soit suffisante.

La création / activation manuelle dans l’interface n’est pas concernée — la porte s’applique au chemin d’adoption automatique issu de la génération de compétences.

## Inventaire des compétences et détecteur de compétences mortes

L’onglet **Inventaire** (à côté de Parcourir) est un tableau de résolution : une ligne par identifiant de compétence, montrant quelle copie l’a emporté, ce qu’elle masque, d’où elle vient, sa fréquence d’utilisation et si elle est activée.

### Priorité

Quand le même identifiant de compétence existe à plusieurs endroits, une seule copie l’emporte selon un ordre fixe et déterministe — jamais selon l’ordre du système de fichiers :

**Utilisateur > Générée > Intégrée par une extension installée > Intégrée avec EYAS lui-même**

En cas d’égalité dans le même rang, le départage se fait par ordre alphabétique : d’abord la racine source, puis le chemin du fichier — la première dans l’ordre l’emporte. Les perdantes ne sont pas abandonnées : elles sont enregistrées et affichées dans la colonne **Masquée**.

### Le détecteur propose, il n’agit jamais

Une analyse en arrière-plan classe chaque compétence activée et, pour celles qu’elle signale, dépose une proposition dans la [file d’approbation d’autonomie](/docs/fr/agents/autonomy/) — elle ne touche rien elle-même. **Il désactive les compétences ; il ne les supprime jamais.** Rien ne change tant que vous n’approuvez pas la proposition, et l’approbation ne fait que désactiver la compétence (le même interrupteur que dans ce tableau) — le fichier et son historique restent intacts.

| Classification | Pourquoi elle est signalée | Nature |
|---|---|---|
| **Orpheline** | son fichier source n’existe plus | fait |
| **Masquée** | une autre source l’emporte toujours sur cet identifiant | fait |
| **Jamais utilisée** | zéro utilisation, et plus ancienne que 90 jours | inférence |
| **Dormante** | déjà utilisée, mais inactive depuis 180 jours ou plus | inférence |

(Valeurs par défaut, configurables par instance.)

Orpheline et masquée sont des faits, pas des suppositions — elles sont proposées dès qu’elles sont détectées. Jamais utilisée et dormante sont des inférences sur l’intention, donc elles sont retenues : une compétence de moins de 30 jours n’est jamais proposée sur cette base, et les compétences que vous avez écrites vous-même — ainsi que celles marquées comme situationnelles, comme les procédures de reprise après sinistre ou de migration destinées à rester en sommeil pendant des mois — sont exemptées des deux vérifications fondées sur le temps.

C’est l’autre bout du cycle de vie par rapport à la **Porte d’adoption automatique** ci-dessus : cette porte décide ce qui est autorisé à entrer, celui-ci décide ce qui est proposé pour sortir.

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Auto-apprentissage et évolution des compétences](/docs/fr/automation/self-learning/)
- [Autonomie](/docs/fr/agents/autonomy/)
