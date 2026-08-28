---
title: Fournisseurs
description: Backends d'IA — chaque type de fournisseur, commandes du panneau, modèles.
---

**Itinéraire :** `/providers`. Sous-titre : *Routage IA, configuration des fournisseurs et contrôle du budget.*

Onglets : **Niveaux de routage · Fournisseurs · Budget · Analyse IA**.

## Cartes de fournisseur

Chaque carte affiche l'identité, l'état de santé et le commutateur d'activation.

| Élément | Signification |
|---------|---------------|
| **Activé / Désactivé** | Activer le fournisseur pour le routage |
| **N/M modèles activés** | Combien de modèles sont actifs |
| **CLI introuvable** | Binaire hôte manquant |
| **Aucune clé API** | Clé requise |
| **Erreur d'authentification** | Identifiants refusés — ressaisissez la clé / reconnectez-vous |

### Descriptions des fournisseurs intégrés (exemples)

| Fournisseur | Rôle |
|-------------|------|
| Anthropic | Claude (Opus, Sonnet, Haiku, Fable) |
| OpenAI | GPT-4o, o3, … |
| OpenRouter | Passerelle multi-fournisseurs |
| Gemini | Google Gemini |
| Kimi | API Moonshot |
| Claude Code CLI / SDK | Session Claude locale |
| Grok CLI / Kimi CLI | CLI ACP locales — reçoivent les outils EYAS via le [pont CLI MCP](/docs/fr/ai/mcp/#cli-mcp-tool-parity-grok--kimi) |
| Ollama / LM Studio / vLLM | Exécutions locales |
| xAI, Mistral, Groq, Together, DeepSeek, … | API cloud telles qu'indiquées sur les cartes |

## Panneau du fournisseur

| Section | Signification |
|---------|---------------|
| **● Actif** | Actuellement sélectionné pour modification |
| **Authentification** | Instructions de clé API ou de session CLI |
| Authentification CLI | Utilise la CLI locale — pas de clé API ; authentifiez-vous via `claude` / `grok` / `kimi` |
| Champs de clé API | Stockés chiffrés dans Secrets |
| Liste des modèles | Activer/désactiver les modèles individuellement |

**Configuration Claude de l'hôte (Claude Code CLI).** Par défaut, EYAS isole les conversations de la configuration Claude de la machine hôte — pas de settings.json (hooks, règles de permissions), pas de fichiers CLAUDE.md, pas de skills de l'hôte ni de serveurs .mcp.json du projet — de sorte que la mémoire propre d'EYAS est la seule source de vérité. Le commutateur « Charger la configuration Claude de l'hôte » du panneau du fournisseur la réactive. Les CLI Grok et Kimi chargent toujours leur propre configuration machine ; EYAS ne peut pas le désactiver. Les paramètres de politique gérés par l'entreprise, là où ils existent, restent appliqués — ce niveau ne peut pas être désactivé depuis EYAS.

## Onglets associés

- [Routage et budget](/docs/fr/ai/routing-budget/) (onglets Niveaux de routage + Budget)
- **Analyse IA** — iframe de benchmarks indépendants intégrés

## Voir aussi

- [Assistant de configuration — Fournisseur d'IA](/docs/fr/setup-wizard/)
- [Secrets](/docs/fr/admin/secrets/)
