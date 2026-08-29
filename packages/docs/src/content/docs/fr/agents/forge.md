---
title: Forge
description: Propositions approuvées par un humain pour l’âme, les compétences ou les outils d’un agent.
---

**À quoi ça sert.** Forge est le chemin humain-dans-la-boucle pour changer comment les agents travaillent. Le système **propose** (soul, skill ou tool) ; vous **Approuver et appliquer** ou **Rejeter**. L’identité ne se réécrit pas toute seule sauf si l’autonomie autorise le self-update — le chemin sûr par défaut est une proposition sur cette page.

## Quand l’utiliser

- Un agent veut changer IDENTITY / soul et ne doit pas éditer le fichier lui-même.
- Du feedback skill ou outil s’est accumulé et **Analyser maintenant** doit en faire des propositions.
- Voir valeur actuelle vs proposée, raisonnement et confiance avant d’appliquer.
- Un journal de commentaires (useful / friction) sans rien appliquer encore.

## Déroulement typique

1. Ouvrez **Forge** dans la barre latérale (**IA**) — route `/forge`.
2. Restez sur **Propositions** (ou passez à **Commentaires**). Filtrez **Toutes / En attente / En test / Approuvée / Rejetée / Appliquée**.
3. Dépliez une carte — surtout sous **Soul proposals**. Lisez actuel vs proposé, puis **Approuver et appliquer** ou **Rejeter**.
4. Le statut doit passer à **Appliquée** (ou **Rejetée**). Onglet workspace de l’agent : IDENTITY doit correspondre au texte appliqué.

## Fonctions

Forge est le chemin **humain dans la boucle** pour modifier en profondeur l'identité / l'âme d'un agent. Les agents (ou le système) **proposent** ; vous **examinez et appliquez** — ou vous rejetez.

## Pourquoi Forge existe

| Chemin | Quand |
|--------|-------|
| Édition directe de l'espace de travail | Vous éditez vous-même les fichiers IDENTITY/SOUL |
| Auto-mise à jour de l'agent | Uniquement si l'autonomie `identitySelfUpdate` l'autorise |
| **Proposition Forge** | Chemin sûr par défaut pour l'amélioration autonome |

Lorsque l'auto-mise à jour d'identité est désactivée dans la configuration / l'autonomie, les agents doivent utiliser des propositions Forge au lieu de réécrire IDENTITY.md directement.

## Carte de proposition d'âme (commandes typiques)

| Commande | Signification |
|----------|---------------|
| Résumé de la proposition | Ce qui changerait |
| Diff / aperçu | Avant vs après |
| **Approuver / Appliquer** | Accepter dans l'espace de travail |
| **Rejeter / Ignorer** | Écarter la proposition |
| Nom de l'agent | Quelle identité est concernée |

Les libellés exacts suivent les locales de la page Forge.

## Voir aussi

- [Identité et espace de travail](/docs/fr/agents/identity-workspace/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Auto-apprentissage](/docs/fr/automation/self-learning/)
