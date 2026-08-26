---
name: git-bisect-debugging
description: Using git bisect to find the commit that introduced a bug
trigger_patterns:
  - "git bisect"
  - "find bad commit"
  - "when did this break"
  - "regression"
capabilities:
  - bisect-workflow
  - regression-finding
  - automated-bisect
version: "1.0.0"
---
# Git Bisect Debugging

## Manual Bisect
```bash
# Start bisect session
git bisect start

# Mark current commit as bad (has the bug)
git bisect bad

# Mark a known good commit (before the bug)
git bisect good v1.0.0    # or a commit hash

# Git checks out a middle commit — test it
# If the bug is present:
git bisect bad
# If the bug is NOT present:
git bisect good

# Repeat until git identifies the first bad commit
# Git will output: "abc1234 is the first bad commit"

# Clean up
git bisect reset
```

## Automated Bisect
```bash
# Provide a test script that exits 0 for good, non-0 for bad
git bisect start HEAD v1.0.0
git bisect run npm test
# or
git bisect run ./test-specific-bug.sh
```

### Test Script Example
```bash
#!/bin/bash
# test-specific-bug.sh
# Returns 0 if the bug is NOT present (good), 1 if it IS present (bad)

# Build the project
bun run build 2>/dev/null || exit 125  # 125 = skip this commit

# Run the specific test
bun test -- --grep "user login" 2>/dev/null
```

## Exit Codes for bisect run
- `0` — commit is good
- `1-124, 126-127` — commit is bad
- `125` — skip this commit (can't test, e.g., build failure)
- `128+` — abort bisect

## Tips
- Start with the widest range possible (last known good to current)
- Use tags for known good versions: `git bisect good v1.2.0`
- Automated bisect with a test script is fastest
- Use `git bisect skip` if a commit can't be tested
- View bisect log: `git bisect log`
- Replay a bisect: `git bisect replay <logfile>`

## After Finding the Bad Commit
1. Read the commit message and diff: `git show <bad-commit>`
2. Understand what changed and why
3. Decide: revert the commit or fix forward
4. If reverting: `git revert <bad-commit>`
5. Write a regression test for the bug

## Common Use Cases
- Performance regression: script measures response time
- UI bug: script checks rendered output
- Test failure: script runs the specific failing test
- Build break: script attempts to build

## Limitations
- Requires a reproducible test for the bug
- Merge commits can complicate bisect (use `--first-parent`)
- Flaky tests cause false results
- Some commits may not build (use exit code 125 to skip)
