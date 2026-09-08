---
name: git-monorepo
description: Monorepo management with Turborepo including workspace setup and task orchestration
trigger_patterns:
  - "monorepo"
  - "turborepo"
  - "workspace"
  - "packages"
  - "mono repo"
capabilities:
  - monorepo-setup
  - workspace-management
  - build-orchestration
version: "1.0.0"
sources:
  - name: turborepo
    url: https://github.com/vercel/turborepo
    license: MIT
---
# Monorepo Management

## Structure
```
my-monorepo/
├── package.json          # Root workspace config
├── turbo.json            # Turborepo pipeline config
├── packages/
│   ├── shared/           # Shared utilities
│   │   └── package.json
│   ├── ui/               # Shared UI components
│   │   └── package.json
│   └── types/            # Shared TypeScript types
│       └── package.json
└── apps/
    ├── web/              # Web application
    │   └── package.json
    └── api/              # API server
        └── package.json
```

## Root package.json
```json
{
  "private": true,
  "workspaces": ["packages/*", "apps/*"]
}
```

## Turborepo Configuration (turbo.json)
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

## Key Concepts
- `^build` means "run build in dependencies first"
- Turborepo caches task outputs — only rebuilds what changed
- Remote caching shares cache across CI and developers
- Task graph respects dependency order automatically

## Common Commands
```bash
# Run build in all packages
turbo run build

# Run tests only in changed packages
turbo run test --filter=...[HEAD^1]

# Run dev in specific app
turbo run dev --filter=web

# Run lint in all packages in parallel
turbo run lint
```

## Inter-package Dependencies
```json
// apps/web/package.json
{
  "dependencies": {
    "@my-org/shared": "workspace:*",
    "@my-org/ui": "workspace:*"
  }
}
```

## Best Practices
- Shared code in `packages/`, applications in `apps/`
- Use TypeScript project references for fast type checking
- Keep package boundaries clean — no circular dependencies
- Use `workspace:*` for internal dependencies
- CI: use `--filter=...[origin/main]` to only build changed packages
- Consistent tooling: same ESLint, Prettier, TSConfig across packages

## When to Use Monorepo
- Multiple related packages with shared code
- Team works across multiple services
- Want consistent tooling and versioning
- NOT for: unrelated projects, very large orgs (consider polyrepo)
