---
name: multi-stage-builds
description: Docker multi-stage builds for optimized production images
trigger_patterns:
  - "multi-stage"
  - "multi stage build"
  - "docker stages"
  - "build stage"
capabilities:
  - devops
version: "1.0.0"
---
# Multi-Stage Docker Builds

## Concept
Multi-stage builds use multiple FROM instructions. Each stage can copy artifacts from previous stages, leaving build tools and intermediate files behind.

## TypeScript/Bun Example
```dockerfile
# Stage 1: Install dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Stage 2: Build
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Stage 3: Production
FROM oven/bun:1-slim AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
```

## Key Benefits
- Final image contains only runtime dependencies (smaller, more secure)
- Build tools (TypeScript compiler, dev dependencies) are excluded
- Each stage has its own cache — changing source code does not invalidate dependency install

## Advanced Patterns

### Selective Stage Building
```bash
# Build only a specific stage
docker build --target build -t myapp:build .
```

### Testing Stage
```dockerfile
FROM build AS test
RUN bun test
```
Tests run during build — image only produced if tests pass.

### Shared Base Stage
```dockerfile
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init

FROM base AS deps
# ...

FROM base AS production
COPY --from=deps ...
```

## Size Comparison
| Strategy | Typical Size |
|----------|-------------|
| Single stage (full) | 800MB+ |
| Multi-stage (slim) | 150-300MB |
| Multi-stage (distroless) | 50-100MB |

## Best Practices
- Name stages (`AS name`) for clarity and `--target` support
- Copy only needed artifacts between stages
- Use the slimmest possible base for the final stage
- Consider distroless images for maximum security
