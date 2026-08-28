---
title: Instances multiples
description: EYAS_HOME, ports, isolation.
---

| Levier | Rôle |
|--------|------|
| `EYAS_HOME` | Données, pid et configuration locale séparés |
| `EYAS_PORT` / `--port` | Port d'écoute sans collision |
| Nom de projet Compose | Plusieurs piles sur un même hôte Docker |

**Ne pointez jamais** deux instances actives vers le même fichier SQLite.
