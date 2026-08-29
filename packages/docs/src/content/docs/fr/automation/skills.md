---
title: Compétences
description: Catalogue de compétences — sources, filtres, inventaire, auto-adoption et proposition en conversation.
---

**À quoi ça sert.** Une compétence est un paquet de procédure markdown que l’agent charge quand le travail correspond à ses motifs. Cette page est le catalogue. Ce n’est pas un outil : les outils s’invoquent ; les compétences disent *comment*.

**Route :** `/skills`. Onglets : **Parcourir** · **Inventaire**. Barre : **Compétences**.

## Quand l'utiliser

- Un playbook répétable (chaîne Odoo, runbook, style maison).
- Import d’un autre assistant — quelle copie d’un id charge vraiment.
- Une conversation a proposé une compétence : la refuser ou l’éteindre globalement.
- Des compétences générées apparaissent et tu veux savoir pourquoi elles sont (ou non) live.

## Déroulement typique

1. **Compétences** (`/skills`).
2. **Parcourir** : cherche ou filtre **Toutes / Compétences propres / Intégrées**, puis **Créer une compétence**.
3. **Nom de la compétence**, **Motifs de déclenchement**, **Contenu / modèle**.
4. **Inventaire** : quelle copie a gagné, usages, activée.
5. En conversation, le tour attend. **L'utiliser**, **Pas cette fois**, ou (owner/admin) **Désactiver**.

## Fonctions

Une compétence qui matche est une **proposition que le tour attend**. Rien ne s’exécute tant que tu n’as pas répondu. **L'utiliser** / **Pas cette fois** (cette conversation seulement) / **Désactiver** (global ; owner/admin seulement). Changement 0.8.15 : le troisième bouton est global. Voir [Conversations](/docs/fr/daily/conversations/).

Auto-adoption : les générées/évoluées **n’entrent pas** live sans un snapshot de benchmark privé au **pass ratio** et **score moyen** minimums. Créer/activer à la main n’emprunte pas cette porte.

**Inventaire :** une ligne par id. Préséance **User > Generated > Bundled (extension) > Bundled (EYAS)**. Le détecteur **ne fait que proposer** : orpheline, ombragée, jamais utilisée (0, >90 j), dormante (180+). [File d’autonomie](/docs/fr/agents/autonomy/). **Désactive, ne supprime jamais.** Orpheline/ombragée tout de suite ; jamais utilisée/dormante après 30 j ; les skills user hors règles de temps.

## Voir aussi

- [Outils](/docs/fr/automation/tools/)
- [Auto-apprentissage](/docs/fr/automation/self-learning/)
- [Autonomie](/docs/fr/agents/autonomy/)
- [Conversations](/docs/fr/daily/conversations/)
- [Recherche](/docs/fr/automation/research/)
