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

**Quel modèle fait le travail.** L'expansion de requêtes, la notation des sources, la rédaction des sections et le recoupement tournent sur le modèle d'arrière-plan d'EYAS : d'abord le niveau de routage **Standard**, puis le modèle par défaut, puis les fournisseurs API, puis les CLI capables de faire des appels isolés — jamais le fournisseur que la passerelle choisit au hasard. Chaque appel est un one-shot isolé (pas d'outils, pas de mémoire du fournisseur ou de l'hôte, un seul tour), apparaît dans le traçage et compte dans le budget. Voir [Routage et budget — Le modèle d'arrière-plan](/docs/fr/ai/routing-budget/#background-model).

**Le contenu web est une donnée, pas une instruction.** Les titres de recherche, extraits, URL, extraits de pages et les sections que le modèle en a tirées lui sont transmis dans un bloc délimité, avec son propre marqueur aléatoire à chaque appel. Le modèle est prévenu que le contenu de ce bloc est une donnée, jamais une instruction : une page hostile ne peut ni fermer le bloc ni donner d'ordres.

**Rapports sans modèle.** Un rapport se termine quand même quand aucun modèle d'arrière-plan ne peut l'écrire : aucun fournisseur ne peut faire d'appels isolés en arrière-plan (par exemple une install Grok seul ou Kimi seul avant que leur isolation soit vérifiée), le budget est arrêté, ou l'appel au modèle a échoué ou a rendu une réponse inutilisable. Dans ce cas, seul le sujet d'origine est recherché ; les sources sont classées dans l'ordre de la recherche (les premières sont conservées) ; le corps a une section par source retenue, avec son titre, son extrait et son URL ; il n'y a pas de recoupement ; et les pages ne sont pas téléchargées quand aucun modèle n'est disponible. Un tel rapport affiche un bandeau au-dessus des sections : *Assemblé sans modèle : aucun modèle d'arrière-plan n'a pu synthétiser ce rapport (aucun ne peut exécuter d'appels isolés en arrière-plan, le budget est à l'arrêt ou l'appel a échoué), les principales sources sont donc listées avec leurs extraits.* L'outil d'agent `research` renvoie `degraded: true` pour ces rapports. Avant, un échec du modèle terminait le travail en **Erreur**. Les rapports existants ne changent pas.

**Superficielle** élargit moins de requêtes liées et conserve moins de résultats ; **Approfondie** en élargit plus, demande plus de résultats par requête et conserve plus de sources d'une pertinence d'au moins 0,5.

La recherche utilise Brave si le secret `brave-search-api-key` existe ; sinon un fournisseur fictif (utile pour l'UI, pas pour le web réel). Rangez la clé sous [Secrets](/docs/fr/admin/secrets/).

Un rapport terminé montre la requête en titre, **Terminée**, la profondeur (*superficielle* / *approfondie*), le nombre de sources et l'heure de fin. Le corps est des **sections** écrites par le modèle (titre + prose). **Sources** liste `[n]` titre (lien) et **N % pertinent**.

Les échecs — ceux qui ne viennent pas du modèle, par exemple la recherche elle-même — affichent **La recherche a échoué** et le texte d'erreur. Cette page n'a ni suppression ni export.

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
| **Erreur** | Le flux a échoué (un échec du modèle ne termine plus le travail ainsi — le rapport se termine alors sans modèle) |

<h2 id="report">Volet rapport</h2>

| Commande | Signification |
|----------|---------------|
| **Recherche en cours…** | Espace réservé avec le badge de statut actuel |
| **La recherche a échoué** | Titre d'erreur ; le corps est le texte |
| Profondeur / nombre de sources / terminé le | Méta d'en-tête d'un rapport fini |
| Titre de section + contenu | Blocs de briefing générés |
| Bandeau *Assemblé sans modèle : …* | Le rapport a été construit sans modèle d'arrière-plan — une section par source retenue, pas de recoupement |
| **Sources** | Liens numérotés avec **N % pertinent** |

## Voir aussi

- [Mémoire](/docs/fr/knowledge/memory/)
- [Documents](/docs/fr/knowledge/documents/)
- [Recherche](/docs/fr/daily/search/)
- [Secrets](/docs/fr/admin/secrets/)
- [Vue d'ensemble des paramètres](/docs/fr/admin/settings/)
