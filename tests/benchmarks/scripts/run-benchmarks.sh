#!/usr/bin/env bash
# EYAS internal benchmark harness — CI entry point.
#
# Usage:
#   bash tests/benchmarks/scripts/run-benchmarks.sh [--held-out] [--category=coding] [--task=coding-001]
#
# Thin wrapper around tests/benchmarks/scripts/run-benchmarks.ts. Picks Bun if
# available, else tsx / ts-node as a Node.js 22+ fallback.

set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${HARNESS_DIR}/../.." && pwd)"
ENTRY="${HARNESS_DIR}/scripts/run-benchmarks.ts"

cd "${REPO_ROOT}"

if command -v bun >/dev/null 2>&1; then
  exec bun "${ENTRY}" "$@"
elif command -v tsx >/dev/null 2>&1; then
  exec tsx "${ENTRY}" "$@"
elif command -v ts-node >/dev/null 2>&1; then
  exec ts-node "${ENTRY}" "$@"
else
  echo "error: need bun, tsx, or ts-node on PATH" >&2
  exit 2
fi
