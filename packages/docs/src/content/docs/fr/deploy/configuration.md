---
title: Configuration
description: YAML par défaut, overlays locaux, précédence env — après avoir choisi un chemin d’install.
---

**À quoi ça sert.** Adresse d’écoute, modules, autonomie, capture mémoire et verify commands sans rebuild. `local.yaml` et `EYAS_*` — pas `config/default.yaml` si tu peux l’éviter.

## Quand l'utiliser

- Hôte/port, niveau de log, désactiver un module.
- Capture de mémoire durable off (`memory.capture.enabled: false`) — défaut on.
- Dossiers extra de skills ou personas (`skills.importRoots` / `agent.importRoots`) sans allumer la config Claude hôte.
- `agent.verifyCommands` pour qu’une course de code ne soit pas « finie » avant les tests.
- Plusieurs checkouts Odoo via `EYAS_ODOO_SOURCES_JSON`.

## Déroulement typique

1. Crée `local.yaml`.
2. Seulement les clés nécessaires. `eyas config validate`.
3. `eyas restart` ou `eyas config reload`.
4. Paramètres + `eyas doctor`.

Précédence : flags CLI → `EYAS_*` → YAML local → YAML par défaut.

```yaml
memory:
  capture:
    enabled: true
    minUserChars: 40
    maxPerConversation: 20
```

```yaml
skills:
  importRoots: []
agent:
  importRoots: []
```

La liste livrée est vide. Chemins dans `local.yaml`. Les skills importées gagnent contre les copies bundled. L’isolation reste active. Voir [Compétences](/docs/fr/automation/skills/).

`agent.verifyCommands` sans shell. `EYAS_AUTO_FAILOVER` remplit les fallbacks de routage vides. `EYAS_BROWSER_USER_DATA_DIR` est le profil headless EYAS (jamais le Chrome quotidien). `EYAS_AGENT_BROWSER_BIN` pointe vers la CLI optionnelle agent-browser (sinon PATH ; chemin défini mais absent = fail-closed). Voir [Mémoire](/docs/fr/knowledge/memory/) et [FAQ](/docs/fr/reference/faq/).

## Voir aussi

- [CLI](/docs/fr/deploy/cli/)
- [Fournisseurs](/docs/fr/ai/providers/)
- [Routage et budget](/docs/fr/ai/routing-budget/)
- [Mémoire](/docs/fr/knowledge/memory/)
