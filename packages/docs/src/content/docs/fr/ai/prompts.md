---
title: Système de prompts
description: Prompts en couches, Améliorateur de prompts et Coaches de prompts à portée.
---

**Itinéraires :** Paramètres → Prompts · **Améliorateur de prompts** de conversation · **Coach de prompt** sur Projets / Agents.

## Couches

| Couche | Portée |
|--------|--------|
| **Maître** | Identité système globale et règles fondamentales (certaines sections verrouillées) |
| **Type de projet** | Valeurs par défaut pour un type de travail |
| **Projet** | Surcharges pour un projet |
| **Conversation** | Ajouts spécifiques au fil / prompts utilisateur ponctuels |
| **System Prompt de l'agent** | Protocole opérationnel au niveau de l'agent ([Configuration](/docs/fr/agents/configure/)) |

| Concept | Signification |
|---------|---------------|
| Section verrouillée | Non modifiable dans l'interface (intégrité de la plateforme) |
| Section éditable | Vous pouvez personnaliser le ton/les règles |
| Héritage | Les couches inférieures affinent les couches supérieures |

---

## Améliorateur de prompts (brouillons de conversation)

S'ouvre depuis le **compositeur** de conversation. Optimise un prompt utilisateur **ponctuel** pour la **famille de modèles** du fil, avec des pastilles de type de tâche, un score de qualité et des alternatives concises/approfondies.

Tableau complet des champs : [Conversations — Améliorateur de prompts](/docs/fr/daily/conversations/#prompt-enhancer-dialog).

---

## Coach de prompt (couches durables)

Les boutons **Coach de prompt** ouvrent un coach conscient du rôle pour du texte **durable** — non mélangé aux brouillons de conversation.

| Portée | Où | Ce qu'il optimise |
|--------|----|-------------------|
| **Type de projet** | Projets → Types de projet → Prompt | Valeurs par défaut réutilisables héritées par les projets de ce type |
| **Projet** | Projets → Projet → Prompt | Brief opérationnel pour toutes les conversations du projet (domaine, conventions, critères de réussite) |
| **Système de l'agent** | Agents → Configuration → System Prompt | Protocole opérationnel de l'agent (ni la voix, ni le domaine du projet, ni des tâches ponctuelles) |

### Commandes de la boîte de dialogue du coach

| Commande | Signification |
|----------|---------------|
| Badge de portée | **Couche projet** / **Couche type de projet** / **systemPrompt de l'agent** |
| Brouillon / réponse | Décrivez l'objectif ou collez un brouillon ; **Envoyer** itératif |
| **Qualité N/10** | Score de liste de contrôle ; **Lacunes** liste les éléments manquants |
| **Proposer deux alternatives** | Variantes concise + approfondie |
| **Brief suggéré** | Candidat à insérer |
| **Appliquer** | Écrire le brief dans le champ du formulaire |

---

## Voir aussi

- [Projets — champs de prompt](/docs/fr/daily/projects/)
- [Agents — system prompt](/docs/fr/agents/configure/)
- [Conversations](/docs/fr/daily/conversations/)
