---
title: Project wiki
description: Per-project wiki — ticket and decision pages for one project, not the global Knowledge tree.
---

**What this is for.** Project wiki is a **per-project** page tree: closed tickets, team-session decisions, playbooks, and delivery facts that must not leak into the global Knowledge wiki or into Memory. Each wiki is keyed by project id. The UI is deliberately small: search, tree, markdown view/edit.

## When to use it

- The page is about **one project** (a closed ticket, a recorded decision, environment notes for that project).
- You do not want that text in the global **Knowledge** tree or in a vault `user` note that every prompt sees.
- You need a searchable tree with tags, breadcrumb, and an **Auto-generated** marker on machine-written pages.
- You are choosing: global wiki → Knowledge; durable identity → Memory; files → Documents; this project only → here.

## Typical workflow

1. Open the wiki from the project card (route `/projects/:projectId/wiki` — there is **no** global sidebar item; this is not **Knowledge**).
2. Use **Search this wiki…** or the left tree. Auto-generated pages show a robot prefix and an **Auto-generated** badge.
3. Click **Edit**, change the markdown, **Save** (or **Cancel**). Saving takes ownership: later auto-updates will not overwrite. Empty: *No pages yet.* / *Select a page to view.*
4. You should see the breadcrumb, optional summary and tags, and the saved markdown. Global Knowledge and Memory stay unchanged.

Auto-update is **off by default**. On the project form, turn on **Closed tickets** and/or **Team decisions** separately. Ticket page body is **Title only** unless you pick last turn or the full conversation.

Closing a board card writes `ticket-<id>` when tickets are on. Completing a team session with findings or decisions writes `decision-<id>` when decisions are on (otherwise the vault promoter still runs). The seed catch-all project does not get wiki pages.

## Features

The current UI is a stub, and it is honest about that: the body is markdown in a monospace block (view) or a textarea (edit). Server-rendered HTML exists (`?render=html`) but is not the default view.

| Control | Meaning |
|---------|---------|
| **Search this wiki…** | Project-scoped search; **Results** list |
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
