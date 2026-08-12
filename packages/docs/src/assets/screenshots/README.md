# Product documentation screenshots

Locale-specific UI screenshots for the Starlight site. **Not committed as binary noise until intentionally added.**

## Layout

```
src/assets/screenshots/
  en/                 # English UI chrome
  hu/                 # Hungarian UI
  de/
  es/
  _shared/            # language-neutral diagrams (architecture, flow)
  README.md           # this file
```

## Naming

```
{area}-{screen}-{detail}.png
```

Examples:

| File | Use on page |
|------|-------------|
| `setup-wizard-master-password.png` | setup-wizard |
| `agents-detail-configuration.png` | agents/configure |
| `daily-board-kanban.png` | daily/board |
| `communication-telegram-instance.png` | communication/telegram |

Prefer **PNG** (UI) or **WebP** if size matters. Max recommended width: **1600px**.

## Multi-language rule

- Capture **each product language separately** under `en/`, `hu/`, `de/`, `es/`.
- Do **not** embed EN UI chrome into HU/DE/ES pages.
- Shared diagrams (no UI strings) go in `_shared/` and may be referenced from all locales.

## Markdown usage (Starlight)

From a page under `src/content/docs/en/...`:

```md
![Board kanban view](../../../assets/screenshots/en/daily-board-kanban.png)
```

From `src/content/docs/hu/daily/board.md`:

```md
![Tábla kanban nézet](../../../assets/screenshots/hu/daily-board-kanban.png)
```

Always set a **descriptive alt text** in the page language.

## When to add screenshots

1. First wave of docs is text-only (current).
2. Add screenshots per chapter when the UI is stable for that screen.
3. Re-capture after major UI redesigns; delete obsolete files in the same PR.

## Git

Large binaries: keep a modest set; avoid full-screen PNG dumps of every dialog.
Optional later: `.gitattributes` LFS if the set grows large.
