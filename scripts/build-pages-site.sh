#!/usr/bin/env bash
# Assemble the GitHub Pages site for the public eyssen/eyas repo.
#
# Layout produced in _site/:
#   index.html      <- docs/eyas-overview.html (self-contained landing page)
#   docs/**         <- packages/docs Starlight build (en, hu, de, es, fr, tlh)
#   .nojekyll       <- keep _astro/ (leading underscore) from being dropped
#
# GitHub project sites live under /<repo>/, so the docs are built with
# DOCS_BASE=/eyas/docs. Astro rewrites the links it generates itself, but the
# hand-written absolute links in the Markdown sources still point at /docs/...
# (the path the main EYAS server uses); those are rewritten here and verified.
#
# Local dry run:  scripts/build-pages-site.sh && python3 -m http.server -d _site
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="${ROOT}/_site"
DOCS_PKG="${ROOT}/packages/docs"

# Repo path prefix of the published site. Empty for a user/org site or a custom
# domain; "/eyas" for the project site at eyssen.github.io/eyas.
PAGES_PREFIX="${PAGES_PREFIX:-/eyas}"
DOCS_BASE="${PAGES_PREFIX}/docs"

if ! command -v bun >/dev/null 2>&1; then
  echo "bun not found in PATH. Install from https://bun.sh" >&2
  exit 1
fi

echo "==> Clean ${SITE}"
rm -rf "${SITE}"
mkdir -p "${SITE}"

echo
echo "==> Build product docs (DOCS_BASE=${DOCS_BASE})"
(
  cd "${DOCS_PKG}"
  # packages/docs is standalone (own bun.lock, no root workspace).
  if [[ ! -d node_modules ]]; then
    bun install --frozen-lockfile
  fi
  DOCS_BASE="${DOCS_BASE}" \
  DOCS_SITE="${DOCS_SITE:-https://eyssen.github.io}" \
    bun run build
)

echo
echo "==> Assemble site"
cp "${ROOT}/docs/eyas-overview.html" "${SITE}/index.html"
cp -R "${DOCS_PKG}/dist" "${SITE}/docs"
touch "${SITE}/.nojekyll"

# Starlight emits its own 404 inside the docs tree; the site root needs one too.
cp "${SITE}/docs/404.html" "${SITE}/404.html"

echo
echo "==> Rewrite hand-written /docs/ links to ${DOCS_BASE}/"
if [[ "${DOCS_BASE}" != "/docs" ]]; then
  # Only href="/docs/... is touched. Verified: the build emits zero escaped
  # (href=&quot;/docs/) occurrences, so code samples cannot be hit by this.
  find "${SITE}/docs" -name '*.html' -print0 \
    | xargs -0 sed -i.bak "s|href=\"/docs/|href=\"${DOCS_BASE}/|g"
  find "${SITE}/docs" -name '*.html.bak' -delete
fi

echo
echo "==> Verify no stale /docs/ links remain"
# grep exits 1 when it finds nothing, which is the success case here.
stale="$(grep -rl 'href="/docs/' "${SITE}" --include='*.html' || true)"
stale_count="$(printf '%s' "${stale}" | grep -c . || true)"
if [[ "${stale_count}" != "0" ]]; then
  echo "FAIL: ${stale_count} file(s) still link to /docs/ instead of ${DOCS_BASE}/" >&2
  printf '%s\n' "${stale}" | head -5 >&2
  exit 1
fi
echo "OK: 0 stale links"

echo
echo "==> Done: ${SITE} ($(du -sh "${SITE}" | cut -f1), $(find "${SITE}" -name '*.html' | wc -l | tr -d ' ') html files)"
