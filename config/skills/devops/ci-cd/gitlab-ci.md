---
name: gitlab-ci
description: GitLab CI/CD pipeline configuration and patterns
trigger_patterns:
  - "gitlab ci"
  - "gitlab pipeline"
  - "gitlab-ci.yml"
  - "gitlab runner"
capabilities:
  - devops
version: "1.0.0"
---
# GitLab CI/CD

## Basic Pipeline
```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - deploy

variables:
  BUN_INSTALL: "$CI_PROJECT_DIR/.bun"

test:
  stage: test
  image: oven/bun:1
  script:
    - bun install --frozen-lockfile
    - bun test
  cache:
    key: $CI_COMMIT_REF_SLUG
    paths:
      - node_modules/
      - .bun/

build:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  only:
    - main

deploy:
  stage: deploy
  image: bitnami/kubectl:latest
  script:
    - kubectl set image deployment/eyas eyas=$CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
  environment:
    name: production
    url: https://eyas.example.com
  when: manual
  only:
    - main
```

## Key Concepts
- **Stages**: sequential phases; jobs within a stage run in parallel
- **Jobs**: individual tasks with scripts, image, and artifacts
- **Artifacts**: files passed between jobs/stages
- **Cache**: files persisted between pipeline runs (dependencies)
- **Services**: sidecar containers (databases, Docker-in-Docker)

## Rules and Conditions
```yaml
deploy:
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
      when: manual
    - if: $CI_MERGE_REQUEST_ID
      when: never
```

## Environments and Review Apps
- Use `environment` to track deployments
- Dynamic environments for merge request review apps
- Protected environments require manual approval

## Best Practices
- Use `rules` instead of deprecated `only/except`
- Pin image versions for reproducibility
- Use `needs` for DAG-based pipelines (skip waiting for full stages)
- Store secrets in CI/CD variables (masked, protected)
- Use `include` for reusable templates across projects
- Set `interruptible: true` for jobs that can be safely cancelled
