# Page template (every product chapter)

Keep stable slugs. Write the same relative path in **all six** locales: `en`, `hu`, `de`, `es`, `fr`, `tlh`.

Prefer `.md` over MDX (braces in prose break MDX).

## Shape

```md
---
title: Short name
description: One sentence: what the reader can do here.
---

**What this is for.** 2–4 sentences. The job this surface does, who uses it, when it matters. Not a field dump.

## When to use it

- Job-to-be-done bullets (3–6). Concrete ("I want the agent to remember a decision") not UI chrome.

## Typical workflow

1. Numbered path a new user can follow in the running app.
2. Name the sidebar item / route (`/memory`).
3. End with the result they should see.

## Features

Prose + tables for the actual capabilities. Cover every tab, action, and non-obvious behaviour on that screen. Do not invent features — read `src/web/src/pages/<area>/` and the module under `src/modules/`.

## Fields and controls

Keep existing field tables when they are accurate. Add missing controls. Stable English heading ids for in-app `?` hashes:

```md
<h2 id="presets">Presets</h2>
```

## Related

- Links to sibling chapters and the concept that explains *why*.
```

## Voice

- Second person, present tense, short sentences.
- Name the UI label in **bold** as it appears in that locale.
- No architecture dump on a how-to page. Point to [Architecture](/docs/en/reference/architecture/) instead.
- English is the source language. Other locales are translations, not independent rewrites.

## Do not

- Run `bun run full-docs` / `generate-full-docs.mjs` — it overwrites prose.
- Commit or create branches.
- Invent screens that are not in the product.
