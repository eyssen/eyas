---
title: Référence CLI
description: serve, start, stop, doctor, config, module.
---

| Commande | Description |
|----------|-------------|
| `eyas serve` | Serveur HTTP au premier plan |
| `eyas start` | Arrière-plan (fichier pid + journal) |
| `eyas stop` | Arrêter l'arrière-plan |
| `eyas restart` | Redémarrer |
| `eyas status` | Santé + PID |
| `eyas doctor` | Diagnostics |
| `eyas version` | Version |
| `eyas config validate` | Valider le YAML |
| `eyas config reload` | Rechargement à chaud lorsque pris en charge |
| `eyas module list` | Lister les modules |
| `eyas module enable/disable <id>` | Activer / désactiver un module |

### Environnement

`EYAS_PORT`, `EYAS_HOST`, `EYAS_HOME`, `EYAS_INSTALL_ROOT`, `EYAS_SKIP_WEB_BUILD`, `EYAS_SKIP_DOCS_BUILD`, `EYAS_FORCE_WEB_BUILD`, `EYAS_FORCE_DOCS_BUILD`.
