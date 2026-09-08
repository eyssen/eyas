---
title: Board
description: Move conversations across stages — kanban, list, timeline, graph, and dashboard.
---

**What this is for.** The Board is the work surface for conversations. Each card is a thread: you drag it across stages, filter by project, and open it to talk. Kanban, list, timeline, graph, and dashboard all read the same filtered set.

## When to use it

- You want to see every open thread in a project as columns (or all projects at once).
- You need to move work to the next stage, pin a card, or spot overdue / stuck / waiting-approval items.
- You want a list you can sort, a timeline of due dates, or a graph of an orchestration run.
- You want today's throughput, cost, and live runs without leaving the board.
- You are about to start a new conversation in a given project and stage.

## Typical workflow

1. Open **Board** in the sidebar (**Main** section) — route `/board`.
2. Pick a project (or **All projects**). Switch **Kanban** / **List** / **Timeline** / **Graph** / **Dashboard** as needed.
3. Drag a card to a new stage, or click it to open the conversation.
4. You should see the card in the new column (and the conversation **Stage** field match). Filters stay when you switch views.

## Features

Tracks conversations as cards across projects and stages.

## Project filter

| Control | Meaning |
|---------|---------|
| **All projects** | Show cards from every project |
| Project picker | Restrict to one project |
| Empty: *No projects yet* | Create a project first ([Projects](/docs/en/daily/projects/)) |

## New conversation

| Control | Meaning |
|---------|---------|
| **New** | Start creating a card/conversation |
| **Conversation title…** | Title for the new conversation |

## Views

| View | What you see |
|------|----------------|
| **Kanban** | Columns by stage (or group-by); drag-and-drop |
| **List** | Tabular rows with sort/filter actions |
| **Timeline** | Time windows of activity and due dates |
| **Graph** | Orchestration or stage-flow graph |
| **Dashboard** | Aggregate metrics for the board |

### Group by (kanban)

| Option | Meaning |
|--------|---------|
| **Stage** | Columns = pipeline stages |
| **Priority** | Columns = priority |
| **Assignee** | Columns = assignee (**Unassigned** bucket) |

## Card fields / badges

| Badge / field | Meaning |
|---------------|---------|
| **Title** | Conversation title (*Untitled* if empty) |
| **Pinned** | Pinned to Board pin strip / Home |
| Status **Working** | Agent actively working |
| Status **Waiting** | Waiting for reply |
| Status **Approval** | Waiting approval |
| Status **Error** | Failed run |
| **N/M** subtasks | Done / total subtasks |
| **N% context** | Context window utilisation hint |
| **Overdue date** | Past due |
| **$cost** | Spend attributed to the card |
| Aging **Nh / Nd / stuck** | How long since update / stuck duration |

## Column controls

| Control | Meaning |
|---------|---------|
| **Fold column** | Collapse column UI |
| **Drop here** | Drop target while dragging |
| **WIP n/limit** | Work-in-progress count vs limit |

## Filters

| Filter | Meaning |
|--------|---------|
| **Stage** | Stage filter |
| **Priority** | Priority filter |
| **Tags** | Tag filter |
| State **Active / Done / All** | Lifecycle state |
| **Name…** | Title search |
| **Content…** | Full-text in content |

**Tags are a board filter, not a project tree.** Category names such as `module` and `area` are examples you create on this instance; values live on the conversation. Pick a project, then a tag, to slice work inside that project. Conversation tags also appear as one `tags: …` line in the prompt suffix (not the cache prefix).

### Priority values

**Urgent · High · Normal · Low**

## List view columns / actions

| Column / action | Meaning |
|-----------------|---------|
| **P** | Priority |
| **ID** | Identifier |
| **Title** | Title |
| **Project** | Project |
| **Updated** | Last update (relative time) |
| **Pin** | Pin/unpin |
| **Archive** | Archive conversation |
| Delete toast + **Undo** | Soft delete with undo |

## Pinned strip

| Label | Meaning |
|-------|---------|
| **Active** | Pinned set |
| Status icons | Working / Waiting for reply / Waiting approval / Error |

## Timeline controls

| Control | Meaning |
|---------|---------|
| Window **1h / 24h / 7d / 30d** | Visible time range |
| **Now** | Current time marker |
| **Agent runs** | Run events |
| **Due** | Due markers |
| **Updated** | Update events |

## Board dashboard metrics

| Metric | Meaning |
|--------|---------|
| **Open tasks** | Not done |
| **Done today** | Completed today |
| **In progress** | Active WIP |
| **Running** | Live agent runs |
| **Waiting approval** | Approval queue |
| **Completed today** | Throughput today |
| **Cost today** | Spend |
| **Throughput** | Completion rate |
| **Activity** | Activity chart |
| **Running now** | Live list |
| **Priority mix** | Distribution |
| **Tasks per stage** | Per-stage counts |
| **Live / Disconnected** | Realtime link health |

## Graph view

| Control | Meaning |
|---------|---------|
| Mode **Orchestration** | Multi-agent run graph |
| Mode **Stage flow** | Stage transition graph |
| **Orchestration run** selector | Which run to visualise |

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Projects](/docs/en/daily/projects/)
- [Home](/docs/en/daily/home/)
