---
title: Client wiki
description: Per-client wiki — delivery notes for one client, not the global Knowledge tree.
---

**What this is for.** Client wiki is a **per-client** page tree: playbooks, environment notes, and delivery facts that must not leak into the global Knowledge wiki or into Memory. Each wiki is keyed by client id. The UI is deliberately small: search, tree, markdown view/edit.

## When to use it

- The page is about **one client** (their staging URL, who signs off, their conventions).
- You do not want that text in the global **Knowledge** tree or in a vault `user` note that every prompt sees.
- You need a searchable tree with tags, breadcrumb, and an **Auto-generated** marker on machine-written pages.
- You are choosing: global wiki → Knowledge; durable identity → Memory; files → Documents; this client only → here.

## Typical workflow

1. Open the wiki for that client (API `/api/v1/client-wiki/:clientId/…` — there is **no** global sidebar item; this is not **Knowledge**).
2. Use **Search this wiki…** or the left tree. Auto-generated pages show a robot prefix.
3. Click **Edit**, change the markdown, **Save** (or **Cancel**). Empty: *No pages yet.* / *Select a page to view.*
4. You should see the breadcrumb, optional summary and tags, and the saved markdown. Global Knowledge and Memory stay unchanged.

## Features

The current UI is a stub, and it is honest about that: the body is markdown in a monospace block (view) or a textarea (edit). Server-rendered HTML exists (`?render=html`) but is not the default view.

| Control | Meaning |
|---------|---------|
| **Search this wiki…** | Client-scoped search; **Results** list |
| Tree | Pages grouped by parent; click to open |
| Breadcrumb | Parent chain of the current page |
| **Edit / Cancel / Save / Saving…** | Markdown round-trip |
| **Auto-generated** | Page was written by the system, not a person |
| Summary | Optional italic blurb under the title |
| Tags | `#tag` chips |
| *No pages yet.* | Empty wiki |
| *Select a page to view.* | Nothing selected |

History and backlinks exist in the API/locales (`History`, `Backlinks`) more fully than in this stub UI — do not expect a version rail like Knowledge.

## Related

- [Knowledge base](/docs/en/knowledge/knowledge-base/)
- [Memory](/docs/en/knowledge/memory/)
- [Projects](/docs/en/daily/projects/)
