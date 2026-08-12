#!/usr/bin/env bash
# Lint + render the EYAS Helm chart with both default values and the
# OCI OKE overlay. Exits non-zero on first failure.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHART_DIR="${ROOT}/deploy/k8s/helm/eyas"

if ! command -v helm >/dev/null 2>&1; then
  echo "helm not found in PATH. Install from https://helm.sh/docs/intro/install/" >&2
  exit 1
fi

echo "==> helm version"
helm version --short

echo
echo "==> helm lint (default values)"
helm lint "${CHART_DIR}"

echo
echo "==> helm lint (values-oci-oke.yaml)"
helm lint "${CHART_DIR}" -f "${CHART_DIR}/values-oci-oke.yaml"

echo
echo "==> helm template (default values, pipe to /dev/null)"
helm template eyas "${CHART_DIR}" >/dev/null

echo
echo "==> helm template (values-oci-oke.yaml, pipe to /dev/null)"
helm template eyas "${CHART_DIR}" -f "${CHART_DIR}/values-oci-oke.yaml" >/dev/null

echo
echo "All checks passed."
