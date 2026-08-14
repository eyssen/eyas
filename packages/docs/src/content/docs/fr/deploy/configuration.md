---
title: Configuration
description: Valeurs YAML par défaut, surcouches locales, priorité des variables d'environnement.
---

| Fichier | Rôle |
|---------|------|
| `config/default.yaml` | Valeurs par défaut livrées |
| `local.yaml` | Fusion de surcouche |
| `.env` | Secrets facultatifs (ne jamais committer) |

Priorité : indicateurs CLI → variables `EYAS_*` → YAML local → YAML par défaut.

Exemples de clés dans default.yaml : `server.host/port`, `database.path`, `log.level`, `modules.disabled`, `autonomy.identitySelfUpdate`.

## Vérification et codage des agents (0.8.6+)

```yaml
agent:
  criticEnabled: true
  criticMaxRounds: 1
  # Deterministic checks after a background run (empty = disabled)
  verifyCommands:
    - name: bun-test
      command: bun
      args: [test]
  # verifyCwd: /absolute/path/to/repo   # default: process.cwd()
```

| Clé | Signification |
|-----|---------------|
| `agent.verifyCommands` | Liste de `{ name, command, args?, timeoutMs? }` — **pas de shell** ; les échecs rouvrent l'agent avec le résumé d'erreur |
| `agent.verifyCwd` | Répertoire de travail de ces commandes |
| `EYAS_ODOO_SOURCE_PATHS` | Racines de checkout Odoo locales, séparées par deux-points ou point-virgule, pour les `odoo_search_*` légers et l'amorçage de sources facultatif |
| `EYAS_ODOO_SOURCES_JSON` | Amorçage multi-versions privilégié : tableau JSON de `{ "path", "label?", "version?", "edition?", "family?", "name?", "tags?" }` — crée des **sources de recherche** inactives au démarrage si ces chemins ne sont pas déjà enregistrés |

### Exemple Odoo multi-versions

```bash
export EYAS_ODOO_SOURCES_JSON='[
  {"path":"/path/to/odoo-18-community","label":"18c","version":"18","edition":"community","family":"odoo"},
  {"path":"/path/to/odoo-18-enterprise","label":"18e","version":"18","edition":"enterprise","family":"odoo"},
  {"path":"/path/to/custom-addons","label":"addons","version":"18","edition":"custom","family":"odoo"}
]'
```

Ouvrez ensuite **Sources de recherche**, **Réindexer** chaque source, et définissez les **sources de code par défaut** sur chaque [Projet](/docs/fr/daily/projects/). Les conversations épinglent les sources dans l'onglet **Sources** — voir [Recherche](/docs/fr/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

Les crochets de politique d'outils s'exécutent à chaque appel d'outil (PreToolUse / PostToolUse) via le ToolExecutor — voir [Outils](/docs/fr/automation/tools/).
