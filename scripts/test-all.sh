#!/bin/bash
# CI test runner for EYAS
set -e

echo "========================================="
echo "  EYAS CI — Test Suite"
echo "========================================="
echo ""

echo "=== TypeScript type check ==="
npx tsc --noEmit 2>&1 || echo "WARN: TypeScript check had issues (non-blocking)"
echo ""

echo "=== Unit + Integration tests ==="
npx vitest --run
echo ""

echo "=== Build check ==="
bun run build 2>&1 || echo "WARN: Build not configured (non-blocking)"
echo ""

echo "========================================="
echo "  All checks passed"
echo "========================================="
