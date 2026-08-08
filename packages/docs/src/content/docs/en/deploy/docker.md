---
title: Docker
description: Compose, volumes, GPU profile.
---

```bash
docker compose up -d
docker compose --profile gpu up -d   # Ollama GPU
docker compose logs -f
docker compose down
```

Image includes backend, frontend dist, and product docs at `/docs/`. Persist `data/` via volume. Port mapping must match `EYAS_PORT` / app listen port (**3100** default).
