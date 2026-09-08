---
name: git-workflow
description: Git branching strategy, PR review, and merge patterns
trigger_patterns: ["git", "branch", "merge", "pull request", "PR review"]
capabilities: [git-access]
version: "1.0.0"
---
# Git Workflow Guide

## Branch Strategy
- `main` — stable, always deployable
- `feat/*` — feature branches from main
- `fix/*` — bug fixes
- `release/*` — release preparation

## PR Review Checklist
1. Tests pass
2. No security vulnerabilities
3. Code follows project conventions
4. Documentation updated if needed
