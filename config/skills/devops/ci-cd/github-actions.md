---
name: github-actions
description: GitHub Actions workflow configuration and best practices
trigger_patterns:
  - "github actions"
  - "ci cd"
  - "workflow"
  - "github workflow"
  - "actions yaml"
capabilities:
  - devops
version: "1.0.0"
---
# GitHub Actions

## Basic Workflow
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun test

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## Matrix Builds
```yaml
strategy:
  matrix:
    runtime: [bun, node]
    os: [ubuntu-latest, macos-latest]
    exclude:
      - runtime: bun
        os: macos-latest
```

## Caching
- Use `actions/cache@v4` for dependency caching
- Docker layer caching with `cache-from: type=gha`
- Bun: cache `~/.bun/install/cache`

## Security
- Pin actions to commit SHA, not tags: `actions/checkout@abc123`
- Use `permissions` to limit GITHUB_TOKEN scope
- Store secrets in repository or organization settings
- Use environments for deployment approvals and secrets scoping

## Reusable Workflows
```yaml
# .github/workflows/reusable-deploy.yml
on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
```

## Best Practices
- Keep workflows focused — one job per concern
- Use `concurrency` to cancel outdated runs
- Set timeouts to prevent stuck workflows
- Use job outputs to pass data between jobs
- Test workflow changes in a branch before merging
