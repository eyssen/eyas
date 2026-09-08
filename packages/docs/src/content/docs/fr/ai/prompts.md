---
title: Système de prompts
description: Prompts en couches — master → type de projet → projet → conversation — plus coaches.
---

**À quoi ça sert.** Chaque tour empile des couches de prompt, pas un blob. **Master** est l’identité globale (certaines sections verrouillées). **Type de projet** et **Projet** affinent. **Conversation** est du fil. Les agents ont un **Prompt système**. Le **Prompt Enhancer** du compositeur n’est que pour les brouillons ponctuels.

**Routes :** `/prompts` (barre **Prompts**), `/prompt-settings`.

## Quand l'utiliser

- Voix maison (**personality** éditable) sans toucher les règles verrouillées.
- Un type de projet doit porter un brief héritable (le formulaire est ce que le modèle voit ; vide hérite du type, `+` étend, tout le reste remplace ; enregistrer écrit `AGENTS.md`).
- Un projet a besoin de conventions de domaine qui ne fuient pas.
- Brouillon faible — Enhancer, pas un changement de couche durable.

## Déroulement typique

1. **Prompts** (`/prompts`) : **Master / Type de projet / Projet / Conversation**.
2. Verrouillés : **Lecture seule**. Le reste : éditer, activer/désactiver, supprimer.
3. `/prompt-settings` : seule **personality** est éditable. Enregistrement : `PATCH /prompts/master/personality`.
4. Brief durable : **Prompt coach** sur le formulaire, **Appliquer**.
5. Prompt utilisateur ponctuel : **Prompt Enhancer** depuis le compositeur.

## Voir aussi

- [Projets](/docs/fr/daily/projects/)
- [Agents — prompt système](/docs/fr/agents/configure/)
- [Conversations](/docs/fr/daily/conversations/)
- [Routage et budget](/docs/fr/ai/routing-budget/)
