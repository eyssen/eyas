---
title: Recherche
description: Lancer une recherche superficielle ou approfondie, suivre le statut, lire le rapport et les sources.
---

**À quoi ça sert.** Recherche lance un travail de recherche web à partir d'une question ou d'un sujet, évalue les sources et rédige un rapport structuré que vous rouvrez plus tard. Les agents peuvent réutiliser le résultat. Vous l'utilisez pour un briefing sourcé plutôt qu'un seul tour de chat. Superficielle est plus rapide ; approfondie élargit plus de requêtes et conserve plus de sources.

## Quand l'utiliser

- Vous voulez un rapport avec des URL citées, pas seulement une réponse du modèle.
- Vous avez besoin d'un passage rapide (**Superficielle (plus rapide)**) ou plus large (**Approfondie (exhaustive)**).
- Vous voulez suivre un travail : **En attente** → **Recherche en cours** → **Évaluation** → **Synthèse** → **Terminée**.
- Un travail a échoué et vous avez besoin du texte d'erreur à droite.

## Déroulement typique

1. Ouvrez **Recherche** dans la barre latérale (`/research`).
2. Sous **Nouvelle recherche**, saisissez un sujet (espace réservé *Saisissez le sujet de recherche…*).
3. Choisissez **Superficielle (plus rapide)** ou **Approfondie (exhaustive)**.
4. **Rechercher**. Le travail apparaît dans la liste de gauche et est sélectionné.
5. Attendez que le panneau de droite affiche **Recherche en cours…** et le statut actuel. Les travaux actifs se rafraîchissent environ toutes les deux secondes.
6. Une fois **Terminée**, lisez les sections et **Sources**. Un clic sur le titre d'une source ouvre l'URL.

Liste vide : *Aucun rapport de recherche pour le moment*. Rien de sélectionné : *Sélectionnez un rapport ou lancez une nouvelle recherche*.

## Fonctions

Les travaux démarrent **En attente**, puis **Recherche en cours** (expansion de requêtes + recherche web), **Évaluation** (pertinence), **Synthèse** (sections + recoupement), puis **Terminée** ou **Erreur**.

**Superficielle** élargit moins de requêtes liées et conserve moins de résultats ; **Approfondie** en élargit plus, demande plus de résultats par requête et conserve plus de sources d'une pertinence d'au moins 0,5.

La recherche utilise Brave si le secret `brave-search-api-key` existe ; sinon un fournisseur fictif (utile pour l'UI, pas pour le web réel). Rangez la clé sous [Secrets](/docs/fr/admin/secrets/).

Un rapport terminé montre la requête en titre, **Terminée**, la profondeur (*superficielle* / *approfondie*), le nombre de sources et l'heure de fin. Le corps est des **sections** écrites par le modèle (titre + prose). **Sources** liste `[n]` titre (lien) et **N % pertinent**.

Les échecs affichent **La recherche a échoué** et le texte d'erreur. Cette page n'a ni suppression ni export.

## Champs et commandes

<h2 id="new-job">Nouvelle recherche</h2>

| Commande | Signification |
|----------|---------------|
| **Nouvelle recherche** | Titre du formulaire |
| Champ sujet | Espace réservé *Saisissez le sujet de recherche…* |
| Profondeur | **Superficielle (plus rapide)** ou **Approfondie (exhaustive)** |
| **Rechercher** | Lancer le travail (désactivé si vide ou en cours d'envoi) |

<h2 id="statuses">Liste et statuts</h2>

| Commande | Signification |
|----------|---------------|
| Liste de gauche | Requête, badge de statut, date de création. Un clic charge le rapport |
| **En attente** | En file, pas encore en recherche |
| **Recherche en cours** | Expansion de requêtes et recherche web |
| **Évaluation** | Noter et filtrer les sources |
| **Synthèse** | Rédiger et recouper les sections |
| **Terminée** | Rapport prêt |
| **Erreur** | Le flux a échoué |

<h2 id="report">Volet rapport</h2>

| Commande | Signification |
|----------|---------------|
| **Recherche en cours…** | Espace réservé avec le badge de statut actuel |
| **La recherche a échoué** | Titre d'erreur ; le corps est le texte |
| Profondeur / nombre de sources / terminé le | Méta d'en-tête d'un rapport fini |
| Titre de section + contenu | Blocs de briefing générés |
| **Sources** | Liens numérotés avec **N % pertinent** |

## Voir aussi

- [Mémoire](/docs/fr/knowledge/memory/)
- [Documents](/docs/fr/knowledge/documents/)
- [Recherche](/docs/fr/daily/search/)
- [Secrets](/docs/fr/admin/secrets/)
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
