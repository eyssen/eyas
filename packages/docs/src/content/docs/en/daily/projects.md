---
title: Projects
description: Project types, projects, stages — every form field.
---

**Route:** `/projects` (also under Settings → Projects).  
Subtitle: *Manage project types, projects, and stage workflows.*

Projects group **conversations** into **stages** with optional default agents and prompts.

## Tabs / sections

| Section | Purpose |
|---------|---------|
| **Projects** | Concrete project instances |
| **Project Types** | Templates for new projects |
| **Stages** | Global workflow stages (shared) |

---

## Projects

Intro: *Projects organize conversations into stages with custom workflows.*

| Field / control | Required | Meaning |
|-----------------|----------|---------|
| **New Project** | — | Open create form |
| **Edit Project** | — | Edit selected project |
| **Name** | Yes | Project display name (e.g. `EYAS v1.0`) |
| **Type** | Yes | Project type template (`Select type…`) |
| **Description** | No | Short description |
| **Color** | No | UI colour chip |
| **Default Agent** | Yes | Agent assigned to new conversations in this project |
| **Prompt** | No | Extra system prompt for conversations in this project |
| **Prompt coach** | — | AI coach for the project operating brief (domain, conventions, success criteria) — [Prompts](/docs/en/ai/prompts/#prompt-coach) |
| **Default code sources** | No | Multi-select of [Search Sources](/docs/en/daily/search/) (e.g. Odoo `18c` + addons). Pinned automatically on **new conversations** in this project and when a conversation’s **Project** field is set to this project |
| Badge **Agent** / **No agent** | — | Whether default agent is set |
| Badge **N sources** | — | How many default code sources are selected |

Empty: create a project to organise conversations.

### Default code sources (multi-version)

1. Register checkouts under **Search Sources** (one source per Odoo version / tree, with **Label** + **Family: odoo**).
2. **Reindex** until status is **ready**.
3. On the project form, check the sources this project should use by default.
4. Open a conversation in the project → right rail **Sources** tab shows the same pins (you can still change them per thread).

See [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

---

## Project Types

Intro: *Templates with prompts and settings for new projects.*

| Field / control | Meaning |
|-----------------|---------|
| **New / Edit Project Type** | CRUD type |
| **Name** | Type name (e.g. Development) |
| **Default Priority** | Low / Normal / High / Urgent for new conversations |
| **Icon** | Icon picker; **Clear icon** removes it |
| **Prompt** | System prompt applied to projects of this type |
| **Prompt coach** | AI coach for reusable project-type defaults — [Prompts](/docs/en/ai/prompts/#prompt-coach) |
| **Color** | Type colour |

Seed types often include **general** and **eyas** (bound to primary agents at setup).

---

## Stages

Intro: *Global workflow stages used by all projects. Drag to reorder.*

| Field / control | Meaning |
|-----------------|---------|
| **Add Stage** / **New Stage** | Create stage |
| **Name** | Stage label (kanban column title) |
| **Closed** | Final stage — work considered done |
| **Folded** | Column collapsed by default on the Board |
| **Bot** (Bot Listen) | AI monitors this stage |
| **Auto-assign** | Agent that receives cards entering this stage and may run autonomously (`None` = off) |

Tooltips: Closed = final; Folded = collapsed; Bot Listen = AI monitors; Auto-assign = hand-off + autonomous run.

---

## How this ties to Board & Chat

1. Create **type** → create **project** with default agent **and optional default code sources**  
2. Define **stages** (global columns)  
3. Conversations on the **Board** move across stages  
4. Conversation fields **Project** / **Stage** mirror this structure  
5. Conversation **Sources** tab inherits the project’s code-source pin (overridable)

## Related

- [Board](/docs/en/daily/board/)
- [Conversations](/docs/en/daily/conversations/)
- [Search sources](/docs/en/daily/search/)
