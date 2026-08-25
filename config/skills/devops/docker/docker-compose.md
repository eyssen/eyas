---
name: docker-compose
description: Docker Compose configuration for multi-container development and deployment
trigger_patterns:
  - "docker compose"
  - "docker-compose"
  - "compose file"
  - "multi container"
capabilities:
  - devops
version: "1.0.0"
---
# Docker Compose

## Basic Structure
```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=sqlite:///data/app.db
    volumes:
      - app-data:/data
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
      timeout: 5s
      retries: 5
    secrets:
      - db_password

volumes:
  app-data:
  db-data:

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

## Profiles
```yaml
services:
  ollama:
    image: ollama/ollama
    profiles: ["gpu"]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```
Activate with: `docker compose --profile gpu up`

## Development vs Production
- Use `compose.override.yml` for dev-specific settings (auto-loaded)
- Mount source code as volumes for hot reload in development
- Use named volumes for persistent data
- Set resource limits in production compose files

## Networking
- Services communicate via service names as hostnames
- Custom networks for isolation between service groups
- Use `expose` for internal ports, `ports` for host-mapped ports

## Best Practices
- Pin image versions — never use `latest`
- Use `depends_on` with health checks for startup ordering
- Externalize secrets — never hardcode in compose files
- Use `.env` file for variable substitution
- Set `restart: unless-stopped` for production services
