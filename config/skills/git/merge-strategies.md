---
name: git-merge-strategies
description: Git merge strategies including merge commits, squash, rebase, and conflict resolution
trigger_patterns:
  - "merge strategy"
  - "squash merge"
  - "rebase"
  - "merge conflict"
  - "git merge"
capabilities:
  - merge-selection
  - conflict-resolution
  - history-management
version: "1.0.0"
---
# Git Merge Strategies

## Merge Types

### Merge Commit (--no-ff)
```bash
git merge --no-ff feature/my-branch
```
- Creates a merge commit preserving branch history
- All individual commits visible in history
- Best for: feature branches you want to track as a unit
- Pros: full history, easy to revert entire feature
- Cons: noisy history with many small commits

### Squash Merge
```bash
git merge --squash feature/my-branch
git commit -m "feat: add user profile feature"
```
- Combines all branch commits into one
- Clean, linear history on main
- Best for: feature branches with messy WIP commits
- Pros: clean history, easy to bisect
- Cons: loses individual commit detail

### Rebase
```bash
git checkout feature/my-branch
git rebase main
git checkout main
git merge --ff-only feature/my-branch
```
- Replays branch commits on top of main
- Linear history without merge commits
- Best for: keeping up-to-date with main, clean PRs
- Pros: cleanest history, easy to read
- Cons: rewrites history (never rebase shared branches)

## When to Use What
| Scenario | Strategy |
|----------|----------|
| Feature branch with clean commits | Rebase + fast-forward |
| Feature branch with messy WIP | Squash merge |
| Long-running branch, multiple contributors | Merge commit |
| Hotfix to main | Cherry-pick or direct commit |
| Release branch | Merge commit (preserve history) |

## Conflict Resolution
```bash
# During merge/rebase
git status                    # See conflicting files
# Edit files, resolve conflicts (remove <<<< ==== >>>> markers)
git add <resolved-files>
git merge --continue          # or git rebase --continue
```

### Tips for Fewer Conflicts
- Merge main into your branch daily
- Keep branches small and focused
- Communicate with teammates about shared files
- Use `.gitattributes` for binary merge strategy

## Dangerous Operations
- `git push --force` — never on shared branches
- `git rebase` on published branches — rewrites history others depend on
- `git reset --hard` — permanently discards commits

## Team Agreement
- Pick ONE strategy and use it consistently
- Document in CONTRIBUTING.md
- Configure GitHub/GitLab default merge method
- Automate with branch protection rules
