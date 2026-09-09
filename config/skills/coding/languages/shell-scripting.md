---
name: shell-scripting
description: Bash and Zsh scripting patterns, safety practices, and common idioms
trigger_patterns:
  - "bash script"
  - "shell script"
  - "zsh"
  - "shebang"
  - "command line"
capabilities:
  - coding
version: "1.0.0"
---
# Shell Scripting Best Practices

## Script Header
```bash
#!/usr/bin/env bash
set -euo pipefail  # exit on error, undefined vars, pipe failures
IFS=$'\n\t'        # safer field separator
```

## Variable Safety
```bash
readonly CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}"
local temp_file=""
temp_file="$(mktemp)" || exit 1
trap 'rm -f "$temp_file"' EXIT
```

## Functions
```bash
log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*" >&2; }
die() { log "FATAL: $*"; exit 1; }
```

## Input Validation
```bash
[[ -f "$1" ]] || die "File not found: $1"
[[ "$count" =~ ^[0-9]+$ ]] || die "Expected number, got: $count"
```

## Loops and Iteration
```bash
# Safe file iteration (handles spaces in names)
while IFS= read -r -d '' file; do
  process "$file"
done < <(find /path -type f -name "*.log" -print0)
```

## Common Patterns
- Use `"$@"` not `$@` — always quote variable expansions
- Prefer `[[ ]]` over `[ ]` for conditionals
- Use `$(command)` not backticks
- Redirect stderr: `command 2>&1 | tee output.log`
- Check command existence: `command -v jq &>/dev/null || die "jq required"`

## Portable Tips
- Avoid bashisms if targeting `/bin/sh`
- Use `printf` over `echo` for reliability
- Test with `shellcheck` for common pitfalls
