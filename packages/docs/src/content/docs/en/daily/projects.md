---
title: Projects
description: Group conversations into types, projects, and shared stages — with default agents and code sources.
---

**What this is for.** Projects are how conversations are grouped. A **project type** is the template; a **project** is the instance (default agent, prompt, code sources); **stages** are the shared kanban columns every project uses. Board cards and chat fields **Project** / **Stage** are this structure.

## When to use it

- You want a new body of work with its own default agent, working folders, and (optionally) default code trees.
- You need a reusable type (priority, icon, prompt, working directories) so new projects start consistent.
- You want conversations created in this project to inherit indexed sources and folders automatically.
- Closed tickets or team decisions should write pages on this project's wiki (opt in per project).
- A stage should auto-assign an agent when a card enters it.

## Typical workflow

1. Open **Settings → Projects** (sidebar **Settings**, **Modules** group) — route `/projects`.
2. Create a **Project Type** if you need a template (prompt, optional **Working directories**), then **New Project** (name, type, default agent, **Working directories**, optional **Default code sources**, optional **Wiki auto-update**).
3. Under **Stages**, add or reorder columns (**Closed**, **Folded**, **Bot**, **Auto-assign** as needed).
4. Open **Board**, pick the project — you should see those stages as columns. A new conversation in that project should pin the same code sources and copy the working folders. The **Wiki** link on the project card opens `/projects/:projectId/wiki`.

## Features

Subtitle in the app: *Manage project types, projects, and stage workflows.*

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
| **Prompt** | No | Extra system prompt for conversations in this project. Empty inherits the type brief. Start with `+` to extend it. Anything else replaces the type brief. The form is what the model sees; a non-empty save also writes `AGENTS.md` on disk (empty prompt deletes that file). |
| **Prompt coach** | — | AI coach for the project operating brief (domain, conventions, success criteria) — [Prompts](/docs/en/ai/prompts/#prompt-coach) |
| **Working directories** | Yes (for file tools) | Named roots (`Name` + absolute path). First path is **Primary**. New conversations inherit this list. Empty list copies the **type** list when you pick that type. File tools refuse if nothing is set. |
| **Default code sources** | No | Multi-select of [Search Sources](/docs/en/daily/search/). Pinned automatically on **new conversations** in this project and when a conversation’s **Project** field is set to this project |
| **Wiki auto-update** | No | Off by default. **Closed tickets** and **Team decisions** separately. **Ticket page body**: **Title only** / **Last turn** / **Full conversation**. The catch-all **General** project never receives pages. |
| **Wiki** | — | Open this project's wiki |
| Badge **Agent** / **No agent** | — | Whether default agent is set |
| Badge **N sources** | — | How many default code sources are selected |

Empty: create a project to organise conversations.

### Default code sources (multi-version)

1. Register checkouts under **Search Sources** (one source per Odoo version / tree, with **Label** + **Family: odoo**).
2. **Reindex** until status is **ready**.
3. On the project form, check the sources this project should use by default.
4. Open a conversation in the project → right rail **Sources** tab shows the same pins (you can still change them per thread).

See [Search — multi-version pin](/docs/en/daily/search/#multi-version-pin-which-tree-may-the-agent-use).

<h3 id="working-directories">Working directories</h3>

Where conversations in this project read and write files. Same shape on the **type** (defaults for new projects) and the **project** (overrides the type). A conversation can still reorder or pin a primary on its **Working folders** control.

Paths are instance data — never product defaults. Use a name the team will recognise (`app`, `docs`) plus an absolute path.

<h3 id="wiki-auto-update">Wiki auto-update</h3>

Off by default. Turn on **Closed tickets** and/or **Team decisions** on this project only. Closing a board card writes `ticket-<id>` when tickets are on. Completing a team session with findings or decisions writes `decision-<id>` when decisions are on (otherwise the vault promoter still runs). Saving a wiki page in the UI takes ownership — later auto-updates will not overwrite. Full behaviour: [Project wiki](/docs/en/knowledge/client-wiki/).

---

## Project Types

Intro: *Templates with prompts and settings for new projects.*

| Field / control | Meaning |
|-----------------|---------|
| **New / Edit Project Type** | CRUD type |
| **Name** | Type name (e.g. Development) |
| **Default Priority** | Low / Normal / High / Urgent for new conversations |
| **Icon** | Icon picker; **Clear icon** removes it |
| **Prompt** | System prompt applied to projects of this type (the reusable brief every project of this type inherits unless the project overrides it) |
| **Prompt coach** | AI coach for reusable project-type defaults — [Prompts](/docs/en/ai/prompts/#prompt-coach) |
| **Working directories** | Default folders for new projects of this type. First path is primary. A project with its own list overrides this. |
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

1. Create **type** (prompt, optional working directories) → create **project** with default agent, working directories, and optional default code sources  
2. Define **stages** (global columns)  
3. Conversations on the **Board** move across stages  
4. Conversation fields **Project** / **Stage** / **Working folders** mirror this structure  
5. Conversation **Sources** tab inherits the project’s code-source pin (overridable); **Folders** inherits the working-directory list  
6. Opt in **Wiki auto-update** if closed tickets or team decisions should land on `/projects/:projectId/wiki`

## Related

- [Board](/docs/en/daily/board/)
- [Conversations](/docs/en/daily/conversations/)
- [Search sources](/docs/en/daily/search/)
- [Project wiki](/docs/en/knowledge/client-wiki/)
- [Prompts](/docs/en/ai/prompts/)
