---
title: Docker
description: Compose, volumes, profil GPU.
---

```bash
docker compose up -d
docker compose --profile gpu up -d   # Ollama GPU
docker compose logs -f
docker compose down
```

L'image inclut le backend, le dist frontend et la documentation produit sous `/docs/`. Persistez `data/` via un volume. Le mappage de ports doit correspondre à `EYAS_PORT` / au port d'écoute de l'application (**3100** par défaut).
