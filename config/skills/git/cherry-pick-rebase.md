---
name: git-cherry-pick-rebase
description: Git cherry-pick and interactive rebase techniques for history management
trigger_patterns:
  - "cherry-pick"
  - "cherry pick"
  - "rebase"
  - "squash commits"
  - "reorder commits"
capabilities:
  - cherry-picking
  - history-rewriting
  - commit-management
version: "1.0.0"
---
# Cherry-Pick and Rebase

## Cherry-Pick
Apply a specific commit from one branch to another.
```bash
# Pick a single commit
git cherry-pick abc1234

# Pick multiple commits
git cherry-pick abc1234 def5678

# Pick a range (exclusive start, inclusive end)
git cherry-pick abc1234..def5678

# Pick without committing (stage changes only)
git cherry-pick --no-commit abc1234
```

### Conflict Resolution
```bash
# If conflict occurs during cherry-pick:
# 1. Resolve conflicts in files
# 2. Stage resolved files
git add <resolved-files>
# 3. Continue
git cherry-pick --continue

# Or abort
git cherry-pick --abort
```

### Use Cases
- Backport a fix to a release branch
- Pull a single feature commit without merging the branch
- Recover a commit from a deleted branch

## Rebase
Replay commits on top of a different base.

### Simple Rebase
```bash
# Update feature branch with latest main
git checkout feature/my-branch
git rebase main
```

### Interactive Rebase
```bash
# Rewrite last N commits
git rebase -i HEAD~5
```

Editor opens with:
```
pick abc1234 First commit
pick def5678 Second commit
pick ghi9012 Third commit
```

### Commands
- `pick` — keep the commit as-is
- `reword` — change the commit message
- `squash` — merge into previous commit, combine messages
- `fixup` — merge into previous commit, discard this message
- `drop` — remove the commit
- `edit` — pause to amend the commit

### Common Operations

**Squash WIP commits into one:**
```
pick abc1234 feat: add user profile
squash def5678 WIP: profile styling
squash ghi9012 fix: profile validation
```

**Reorder commits:**
```
pick ghi9012 fix: profile validation
pick abc1234 feat: add user profile
```

## Safety Rules
- NEVER rebase commits that have been pushed to a shared branch
- NEVER force-push to main/develop
- Use `--force-with-lease` instead of `--force` (safer)
- Always backup before complex rebase: `git branch backup-branch`

## When to Use
| Task | Tool |
|------|------|
| Backport a fix | Cherry-pick |
| Clean up branch history before PR | Interactive rebase |
| Update branch with latest main | Rebase (or merge) |
| Combine WIP commits | Interactive rebase (squash) |
| Fix a commit message | Rebase (reword) |
