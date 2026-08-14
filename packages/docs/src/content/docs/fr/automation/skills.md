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

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Auto-apprentissage et évolution des compétences](/docs/fr/automation/self-learning/)
