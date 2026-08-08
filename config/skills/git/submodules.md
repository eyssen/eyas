---
name: git-submodules
description: Git submodules management for including external repositories
trigger_patterns:
  - "git submodule"
  - "submodule"
  - "nested repository"
  - "external dependency"
capabilities:
  - submodule-management
  - dependency-tracking
  - repository-composition
version: "1.0.0"
---
# Git Submodules

## Adding a Submodule
```bash
# Add a submodule at a specific path
git submodule add https://github.com/owner/repo.git path/to/submodule

# Add at a specific branch
git submodule add -b main https://github.com/owner/repo.git path/to/submodule
```

Creates:
- `.gitmodules` file (tracks submodule config)
- `path/to/submodule/` directory (submodule content)

## Cloning a Repo with Submodules
```bash
# Clone and initialize submodules
git clone --recurse-submodules https://github.com/owner/repo.git

# Or if already cloned:
git submodule init
git submodule update
```

## Updating Submodules
```bash
# Update all submodules to their tracked commit
git submodule update --init --recursive

# Update submodule to latest remote commit
cd path/to/submodule
git pull origin main
cd ..
git add path/to/submodule
git commit -m "chore: update submodule to latest"

# Update all submodules to latest
git submodule update --remote
```

## Removing a Submodule
```bash
# 1. Remove from .gitmodules
git config -f .gitmodules --remove-section submodule.path/to/submodule

# 2. Remove from .git/config
git config --remove-section submodule.path/to/submodule

# 3. Remove the submodule directory
git rm --cached path/to/submodule
rm -rf path/to/submodule
rm -rf .git/modules/path/to/submodule

# 4. Commit
git commit -m "chore: remove submodule"
```

## Common Issues

### Submodule Not Initialized
```bash
git submodule update --init --recursive
```

### Detached HEAD in Submodule
Submodules always check out a specific commit (detached HEAD).
To work on a branch:
```bash
cd path/to/submodule
git checkout main
# Make changes, commit, push
```

### Forgotten Submodule Update
```bash
# After pulling main, always:
git submodule update --init --recursive
```

## Alternatives to Submodules
- **Subtree:** merges external repo into your tree (simpler but larger repo)
- **Package manager:** npm/pip dependencies (better for libraries)
- **Monorepo:** if you own both repos, merge into one

## Best Practices
- Pin submodules to specific commits (not branches) for reproducibility
- Document submodule setup in README
- Add `git submodule update --init --recursive` to your setup script
- Use CI to verify submodules are up to date
- Consider if a package manager dependency is simpler
