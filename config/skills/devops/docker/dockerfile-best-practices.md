---
name: dockerfile-best-practices
description: Writing efficient, secure, and maintainable Dockerfiles
trigger_patterns:
  - "dockerfile"
  - "docker build"
  - "docker image"
  - "container image"
  - "docker best practice"
capabilities:
  - devops
version: "1.0.0"
---
# Dockerfile Best Practices

## Layer Optimization
- Order instructions from least to most frequently changing
- Copy dependency files (package.json) before source code for better caching
- Combine related RUN commands with `&&` to reduce layers
- Use `.dockerignore` to exclude node_modules, .git, tests, docs

## Example: Node.js/Bun Application
```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Dependencies layer (cached unless package.json changes)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Application layer
COPY src/ ./src/
COPY config/ ./config/

# Runtime
USER bun
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
```

## Security
- Never run as root — use `USER` instruction
- Use specific image tags, never `latest`
- Scan images for vulnerabilities (Trivy, Snyk)
- Do not copy secrets into images — use build secrets or runtime injection
- Set `readOnlyRootFilesystem: true` in Kubernetes security context

## Size Optimization
- Use slim/alpine base images when possible
- Remove package manager caches in the same layer as install
- Use multi-stage builds to exclude build tools from final image
- Avoid installing unnecessary packages

## Health Checks
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
```

## Labels and Metadata
```dockerfile
LABEL org.opencontainers.image.source="https://github.com/org/repo"
LABEL org.opencontainers.image.version="1.0.0"
```
