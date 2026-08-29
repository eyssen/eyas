---
title: Knowledge base
description: Curated wiki you edit — spaces, pages, versions — not automatic memory.
---

**What this is for.** Knowledge is the wiki **you** maintain: spaces, a page tree, a rich editor, versions, backlinks, and attachments. Capture does not write here. Use it for playbooks, runbooks, and reference you want to keep stable. Memory/vault is for facts the assistant should recall on its own.

## When to use it

- You want a curated page (how we ship, on-call notes, a glossary) that people edit, not a chat-extracted note.
- You need spaces and a tree, with move / rename / delete, not a flat vault file.
- You want versions, backlinks, or attachments on a page.
- You need to export a page as Markdown.
- The fact is about a **client** — that belongs in [Client wiki](/docs/en/knowledge/client-wiki/), not here.

## Typical workflow

1. Open **Knowledge** in the sidebar (**Content** section) — click the row to expand the tree. Route `/knowledge/:pageId` for a page.
2. **New space** if you need one, then **New page** under it. Click the title to rename.
3. Write in the editor (toolbar: headings, lists, checklist, table, callout, …). Autosave after a short pause; the **vN** badge ticks.
4. Attach files from the **Attachments** strip if needed. You should see the page in the tree and in global search.

## Features

**Route:** `/knowledge`. This is **explicit** knowledge. Automatic durable facts live under [Memory](/docs/en/knowledge/memory/).

### Sidebar tree

| Control | Meaning |
|---------|---------|
| **Knowledge** | Expand/collapse the tree |
| **New space** | Create a space (prompt for name) |
| **Search pages…** | Filter the tree |
| **New page** | Child page under the current node |
| **Rename / Move to… / Delete** | Page or space actions (delete space deletes its pages) |

### Page

| Control | Meaning |
|---------|---------|
| Title field | Click to rename (Enter to commit, Escape to revert) |
| **vN** | Current version |
| **AI edited** | Last writer was the system |
| **Export** | Download as Markdown |
| **Width** | Toggle full width |
| Delete | *Move this page to trash?* |
| Editor | BlockNote / Saker toolbar — autosave |
| **Attachments** | Files on this page (collapsible) |
| **Backlinks (N)** | Other pages / vault notes that link here |
| **Versions** | Last five — **You** vs **AI**, date; click to select |

Editor toolbar (as labelled): **Bold, Italic, Underline, Strikethrough, Inline Code, Heading 1–3, Paragraph, Bullet List, Numbered List, Checklist, Table, Code Block, Callout, Link, Image, Toggle, Divider, Clear Formatting**.

## Related

- [Memory](/docs/en/knowledge/memory/)
- [Documents](/docs/en/knowledge/documents/)
- [Client wiki](/docs/en/knowledge/client-wiki/)
