---
title: Pipelines
description: Ticket-to-code runs — ingest, clarify, design, implement, review, PR, deploy.
---

**What this is for.** A pipeline is an orchestrated multi-step job. The product surface today is **ticket-to-code**: take a Board ticket (or a manual id), run it through ingest → PM clarify → architect design → implement → review → open PR → deploy, with a human gate when a stage waits. It is not a generic workflow editor — you start a run, watch stages, approve or cancel.

**Route:** `/pipelines`. Subtitle: *Ticket-to-code pipeline runs — ingest, clarify, design, implement, review, PR, deploy.*

## When to use it

- A Board ticket is ready to become a code change and you want a staged run, not a single chat.
- You need a review or deploy gate before the next stage starts.
- A run failed or was cancelled and you want to **Resume** from where it stopped.
- You want a history of ticket → stage → finished time without opening each conversation.

## Typical workflow

1. Open **Pipelines** in the sidebar (`/pipelines`).
2. Under **Start a run**, pick source **board** or **manual**, enter the **Ticket id**, press **Start**.
3. EYAS opens the run page (`/pipelines/<runId>`). Stages light up in order.
4. When a stage is **Awaiting approval**, press **Approve**. **Cancel** stops a live run; **Resume** restarts a failed or cancelled one.
5. **Refresh** reloads status (the page does not poll). Done when the run badge is **Completed**.

## Features

Ticket sources are the internal EYAS **board** and **manual** entry — there is no third built-in ticket system.

| Concept | Meaning |
|---------|---------|
| Pipeline definition | Named flow template (ticket-to-code) |
| Run | One execution instance |
| Ticket source | `board` or `manual` |
| Stage | One step in the fixed chain |
| Gate / approval | Human checkpoint mid-flow |
| Artifact | Output of a stage (linked when present) |

## Fields and controls

<h2 id="start-run">Start a run</h2>

| Control | Meaning |
|---------|---------|
| Source **board** / **manual** | Where the ticket id comes from |
| **Ticket id** | Id to ingest |
| **Start** | Create the run and open it |
| **Refresh** | Reload the run list |

List columns: **Status**, **Ticket**, **Stage**, **Started**, **Finished**, **View**. Empty: *No pipeline runs yet.*

<h2 id="run-status">Run status</h2>

| Status | Meaning |
|--------|---------|
| **Running** | A stage is in progress |
| **Waiting for approval** | Blocked on a human gate |
| **Completed** | All stages finished |
| **Failed** | A stage failed — **Resume** is offered |
| **Cancelled** | Stopped — **Resume** is offered |

<h2 id="stages">Stages</h2>

| Stage | Meaning |
|-------|---------|
| **Ingest** | Load the ticket |
| **PM Clarify** | Clarify scope |
| **Architect Design** | Design the change |
| **Dev Implement** | Write the code |
| **Review** | Review the change |
| **Open PR** | Open a pull request |
| **Deploy** | Deploy |

<h2 id="stage-status">Stage status</h2>

| Status | Meaning |
|--------|---------|
| **Pending** | Not started |
| **Running** | In progress |
| **Succeeded** | Done |
| **Failed** | Error on the stage |
| **Skipped** | Not run |
| **Awaiting approval** | Press **Approve** to continue |

Run page actions: **Refresh**, **Cancel** (while not completed/cancelled), **Resume** (failed or cancelled), **Approve** on a waiting stage.

## Related

- [Agents / runs](/docs/en/agents/runs/)
- [Projects](/docs/en/daily/projects/)
- [Board](/docs/en/daily/board/)
- [Skills](/docs/en/automation/skills/)
