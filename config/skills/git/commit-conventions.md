---
name: git-commit-conventions
description: Conventional commits format and commit message best practices
trigger_patterns:
  - "commit message"
  - "conventional commits"
  - "commit format"
  - "commit convention"
capabilities:
  - commit-formatting
  - changelog-generation
  - semantic-versioning
version: "1.0.0"
sources:
  - name: conventional-commits
    url: https://github.com/conventional-commits/conventionalcommits.org
    license: MIT
---
# Commit Conventions

## Conventional Commits Format
```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

## Types
- `feat`: new feature (triggers MINOR version bump)
- `fix`: bug fix (triggers PATCH version bump)
- `docs`: documentation only
- `style`: formatting, no code change
- `refactor`: code change that neither fixes a bug nor adds a feature
- `perf`: performance improvement
- `test`: adding or updating tests
- `chore`: build, CI, tooling changes
- `ci`: CI/CD configuration
- `build`: build system or dependencies
- `revert`: revert a previous commit

## Breaking Changes
```
feat(api)!: remove deprecated /v1/users endpoint

BREAKING CHANGE: The /v1/users endpoint has been removed.
Use /v2/users instead.
```
- `!` after type/scope indicates breaking change (triggers MAJOR bump)
- `BREAKING CHANGE:` in footer for detailed explanation

## Examples
```
feat(auth): add OAuth2 login with Google

fix(parser): handle empty input without crashing

Closes #42

docs: update API reference for v2 endpoints

refactor(db): extract connection pool into separate module

No functional changes. Improves testability.

chore(deps): update drizzle-orm to 0.30.0
```

## Rules
- Subject line: imperative mood ("add" not "added" or "adds")
- Subject line: max 72 characters
- Subject line: no period at the end
- Body: wrap at 72 characters
- Body: explain WHAT and WHY, not HOW
- Reference issues: `Closes #123`, `Fixes #456`, `Refs #789`

## Scope Examples
- Module/package name: `feat(auth)`, `fix(parser)`
- File or area: `docs(readme)`, `test(e2e)`
- Keep consistent within the project

## Benefits
- Automated changelog generation
- Semantic version bumping
- Clear, searchable git history
- Better code review context
