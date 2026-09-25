---
name: git-branching-strategies
description: Git branching models including Git Flow, GitHub Flow, and trunk-based development
trigger_patterns:
  - "branching strategy"
  - "git flow"
  - "github flow"
  - "trunk based"
  - "branch model"
capabilities:
  - branching-model-selection
  - branch-management
  - release-strategy
version: "1.0.0"
---
# Git Branching Strategies

## Models

### Trunk-Based Development
- Everyone commits to `main` (or very short-lived branches)
- Feature flags for incomplete features
- CI/CD deploys from main continuously
- Best for: small teams, high trust, strong CI/CD
- Risk: broken main without good test coverage

### GitHub Flow
- `main` is always deployable
- Feature branches from `main`
- Pull request for review
- Merge to `main` and deploy
- Best for: web apps with continuous deployment

### Git Flow
- `main` — production releases only
- `develop` — integration branch
- `feature/*` — from develop, merge back to develop
- `release/*` — from develop, merge to main + develop
- `hotfix/*` — from main, merge to main + develop
- Best for: versioned software with scheduled releases

### Release Branch Model
- `main` — latest stable
- `release/X.Y` — maintained release branches
- Cherry-pick fixes to active release branches
- Best for: software supporting multiple versions

## Branch Naming Conventions
```
feature/TICKET-123-add-user-profile
bugfix/TICKET-456-fix-login-redirect
hotfix/TICKET-789-security-patch
release/1.2.0
chore/update-dependencies
```

## Choosing a Strategy
| Factor | Trunk-Based | GitHub Flow | Git Flow |
|--------|------------|-------------|----------|
| Team size | 1-5 | 2-15 | 5+ |
| Release cadence | Continuous | Continuous | Scheduled |
| Complexity | Low | Low | High |
| Feature flags | Required | Optional | Not needed |
| QA process | Automated | PR review | Dedicated phase |

## Branch Protection Rules
- Require PR reviews before merge (1-2 reviewers)
- Require CI checks to pass
- No force push to main/develop
- Require up-to-date branches before merge
- Automatically delete merged branches

## Tips
- Keep branches short-lived (< 1 week ideally)
- Merge main into your branch daily to reduce conflicts
- One concern per branch — don't mix features
- Delete branches after merge
