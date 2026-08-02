# EYAS Docs

User and admin product documentation for EYAS, built with **[Astro Starlight](https://starlight.astro.build/)**.

## Goals

| Goal | How |
|------|-----|
| Lives in the repo | Markdown under `src/content/docs/{en,hu,de,es}/` (prefer `.md` over MDX — braces in prose break MDX) |
| Multi-language | Starlight locales: **en**, **hu**, **de**, **es** (product languages) |
| In-app `?` help | Stable ids in `help-map.json` → path + optional hash |
| Standalone deploy | `astro build` → static `dist/` for any web server |
| Screenshots later | Locale assets under `src/assets/{locale}/` (empty for now) |

This package is the only published product documentation. Internal design drafts are not in the public tree.


## Screenshots

Locale-specific UI captures live under `src/assets/screenshots/{en,hu,de,es}/`.

- Convention and naming: [`src/assets/screenshots/README.md`](./src/assets/screenshots/README.md)
- First content wave is **text-only**; add images when a chapter is stable
- Never reuse one language’s UI chrome for another locale

## Commands

From this package:

```bash
bun install
bun run dev      # http://localhost:4321/docs/
bun run build    # → dist/
bun run preview
```

From the monorepo root:

```bash
bun run docs:dev
bun run docs:build
bun run docs:preview
```

### Served by the main EYAS server

`eyas serve` / `eyas start` auto-build the docs when missing/stale and
serve it at **`http://<host>:<port>/docs/`** (same process as the API + UI).
No separate Starlight process is required in normal use.

| Env | Effect |
|-----|--------|
| `EYAS_SKIP_DOCS_BUILD=1` | Never auto-install/build docs |
| `EYAS_FORCE_DOCS_BUILD=1` | Always rebuild on start |

`docs:dev` remains available for live-reload authoring only.

### Base path

| Deploy target | Build |
|---------------|--------|
| Served by EYAS at `/docs` (default) | `bun run build` |
| Domain root (standalone site) | `DOCS_BASE=/ bun run build` |

Optional site URL for sitemap/canonical:

```bash
DOCS_SITE=https://docs.example.com bun run build
```

## Information architecture

See **[OUTLINE.md](./OUTLINE.md)** for the locked section map (user-journey based, not 1:1 modules).

### Generate / refresh product docs

```bash
bun run full-docs  # export UI field catalog + write all chapter pages (en/hu/de/es)
bun run build
```

- `scripts/export-field-catalog.mjs` — reads `src/web/src/pages/**/locales/{en,hu,de,es}.json` → `field-catalog.json`
- `scripts/generate-full-docs.mjs` — overview prose + per-field tables + deploy/reference chapters
- `scripts/generate-skeleton.mjs` — IA outline / sidebar only (structure)

Welcome pages (`index.md`) are maintained by hand.

## Content layout

```
src/content/docs/{en,hu,de,es}/
  index.md, getting-started.md, setup-wizard.md, concepts.md
  daily/…  agents/…  automation/…  knowledge/…
  communication/…  ai/…  admin/…  deploy/…  reference/…
help-map.json              # UI help id → path + hash (one entry per page)
sidebar.generated.json     # Starlight sidebar (from skeleton script)
OUTLINE.md
```

### Adding a page

1. Create the same relative path under **all four** locales (or accept English fallback).
2. Add a sidebar entry in `astro.config.mjs` (with `translations` for hu/de/es).
3. If the page is a contextual-help target, add an entry to `help-map.json`.
4. For section-level help, use a **stable English id** on headings in every language
   (Starlight does not honor `{#slug}` — use an HTML heading):

   ```md
   <h2 id="presets">Presetek</h2>
   ```

### Screenshots (deferred)

When ready:

```
src/assets/en/board-kanban.png
src/assets/hu/board-kanban.png
…
```

Reference from MDX with locale-appropriate paths; avoid embedding one language’s UI chrome into another.

## Help map (for the React app)

`help-map.json` is the contract for future `?` icons:

```json
"agents.voice.presets": {
  "path": "agents/voice",
  "hash": "presets"
}
```

Resolved URL shape:

```
{basePath}/{locale}/{path}/#{hash}
→ /docs/hu/agents/voice/#presets
```

The React app imports this file via `@eyas-docs/help-map.json` and opens pages with the `ContextualHelp` (`?`) component (`src/web/src/components/docs/contextual-help.tsx`). The static site is served by the main EYAS process at `/docs/*` (and proxied by Vite in `dev:web`).

## Standalone nginx example

```nginx
server {
  listen 80;
  server_name docs.example.com;
  root /var/www/eyas-docs;   # contents of packages/docs/dist
  location / {
    try_files $uri $uri/ $uri.html /index.html;
  }
}
```

If the site was built with default `base: /docs`, either:

- build with `DOCS_BASE=/` for this host, or
- proxy `location /docs/ { alias /var/www/eyas-docs/; }`.

## Out of scope (this package)

- Internal design drafts (not published)
- UI string i18n (`src/web/**/locales/*.json`)
- In-app HelpCircle wiring (phase after static serve is hooked up)
