---
title: Board
description: Work board — kanban, list, timeline, graph, dashboard views and every control.
---

**Route:** `/board`. Tracks conversations as cards across projects and stages.

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
- [Dashboard](/docs/en/daily/dashboard/)
