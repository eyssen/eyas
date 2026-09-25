---
name: git-hooks
description: Git hooks setup with Husky and lint-staged for automated code quality checks
trigger_patterns:
  - "git hooks"
  - "pre-commit hook"
  - "husky"
  - "lint-staged"
  - "commit hook"
capabilities:
  - hook-setup
  - pre-commit-checks
  - automated-formatting
version: "1.0.0"
sources:
  - name: husky
    url: https://github.com/typicode/husky
    license: MIT
  - name: lint-staged
    url: https://github.com/lint-staged/lint-staged
    license: MIT
---
# Git Hooks

## Available Hooks
- `pre-commit`: runs before commit is created (lint, format, test)
- `commit-msg`: validate commit message format
- `pre-push`: runs before push (full test suite, build check)
- `prepare-commit-msg`: modify default commit message
- `post-merge`: runs after merge (install dependencies if lockfile changed)

## Husky Setup
```bash
npm install -D husky lint-staged
npx husky init
```

Creates `.husky/` directory with hook scripts.

### Pre-commit Hook (.husky/pre-commit)
```bash
#!/bin/sh
npx lint-staged
```

### Commit-msg Hook (.husky/commit-msg)
```bash
#!/bin/sh
npx --no -- commitlint --edit $1
```

## lint-staged Configuration
In `package.json`:
```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md,yml,yaml}": [
      "prettier --write"
    ],
    "*.py": [
      "ruff check --fix",
      "ruff format"
    ]
  }
}
```

## Common Hook Recipes

### Type-check on Pre-push
```bash
#!/bin/sh
# .husky/pre-push
npx tsc --noEmit
```

### Auto-install Dependencies After Merge
```bash
#!/bin/sh
# .husky/post-merge
changed_files=$(git diff-tree -r --name-only --no-commit-id HEAD@{1} HEAD)
if echo "$changed_files" | grep -q "package-lock.json\|bun.lockb"; then
    echo "Dependencies changed, running install..."
    bun install
fi
```

## Best Practices
- Keep pre-commit hooks fast (< 10 seconds) — use lint-staged for partial checks
- Run full test suite in pre-push, not pre-commit
- Never skip hooks (`--no-verify`) unless debugging
- Commit `.husky/` directory to share hooks with team
- Use `npx` to ensure correct tool versions
- If a hook fails, the git operation is aborted — fix and retry

## Troubleshooting
- Hook not running: check file permissions (`chmod +x .husky/*`)
- Hook too slow: lint only staged files (lint-staged)
- CI conflicts: hooks run locally, CI runs its own checks
- Bypass (emergency only): `git commit --no-verify`
