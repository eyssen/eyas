---
title: Runs & Mission Control
description: Supervise live agent runs — cancel, resume, retry — and watch the live ops board.
---

**What this is for.** **Agent Runs** is the table of executions: live and finished, with status, verification, turns, tokens, and actions. **Mission Control** is the live ops board of agent cards — who is running, waiting on you, or paused. Use the table for history and recovery; use Mission Control for a glance at now.

## When to use it

- A run is stuck, hit max turns, or failed — you want **Resume** (checkpoint) or **Retry** (from the goal).
- Something is running and you need **Cancel** without opening the conversation.
- You want to see whether the completeness critic marked **Goal met** / **Goal not met**.
- You need totals: running, waiting approval, completed today, cost today.
- You want to pause, interrupt, or open the conversation from a live card.

## Typical workflow

1. Open **Agent Runs** in the sidebar (**AI** section) — route `/agent-runs`. Or **Mission Control** under **Monitoring** — route `/mission-control`.
2. On Agent Runs, scan **Status** and **Verification**. For an active row, **Cancel**; for a failed/stuck/cancelled/max-turns row, **Resume** or **Retry**.
3. On Mission Control, read the totals strip, then act on a card (**Pause**, **Resume**, **Interrupt**, **Open conversation**).
4. You should see the row/card change status live (WebSocket). Opening the conversation shows the same run's progress, run tree, and tool calls.

## Features

## Agent Runs

**Route:** `/agent-runs`. Subtitle: *Live supervision of agent runs — stuck runs are detected and cancellable.* Empty: *No agent runs yet.*

| Column | Meaning |
|--------|---------|
| **Status** | See statuses below |
| **Verification** | Completeness critic: **Goal met** / **Goal not met** / **Unverified** (or — if never checked) |
| **Agent** | Agent id |
| **Kind** | Run kind (or —) |
| **Turns** | Turns used |
| **Tokens** | Tokens used |
| **Last progress** | Time since last heartbeat |
| Actions | **Cancel** (active) · **Resume** · **Retry** |

### Statuses

| Status | Meaning |
|--------|---------|
| **Running** | In progress |
| **Stuck** | No progress — cancellable / retryable |
| **Refreshing** | Warm-resume in flight |
| **Waiting approval** | Parked on an autonomy approval |
| **Completed** | Finished |
| **Max turns** | Hit the turn budget without finishing — resume or retry |
| **Failed** | Error |
| **Cancelled** | Stopped |

### Verification

| Badge | Meaning |
|-------|---------|
| **Goal met** | A reviewer model checked the output against the goal and found it achieved |
| **Goal not met** | The goal was not achieved; gaps were handed back to the agent once |
| **Unverified** | Could not be checked (no reviewer model, or nothing recorded) |

**Resume** continues from the last checkpoint (do-not-repeat guard). **Retry** re-plans from the goal; already-executed destructive calls stay guarded.

## Mission Control

**Route:** `/mission-control`. Subtitle: *Live view of all running agents.* Empty: *No agents are running.* Banner **Disconnected — reconnecting…** when the socket is down.

### Totals

| Metric | Meaning |
|--------|---------|
| **Running** | Live now |
| **Waiting approval** | Parked on you |
| **Completed today** | Throughput today |
| **Cost today** | Spend today |

Cards sort waiting-approval first, then running, paused, idle, failed, completed, cancelled.

| Card control | Meaning |
|--------------|---------|
| Status | **Idle · Running · Waiting approval · Paused · Completed · Failed · Cancelled** |
| **Turn / Tokens / Cost** | Usage |
| **N pending approval(s)** | Queue on this session |
| **Pause / Resume / Interrupt** | Control (owner or admin) |
| **Open conversation** | Jump to the thread |

Use Mission Control when you need an at-a-glance ops view; use Agent Runs for history and recovery.

## Inside a conversation

While a run is active you also see:

- Agent progress (turn N/max, tokens, Cancel)  
- Run tree / workflow  
- Tool call expanders  

Documented under [Conversations](/docs/en/daily/conversations/).

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Home — Now running](/docs/en/daily/home/)
- [Autonomy](/docs/en/agents/autonomy/)

## Brand compliance

When a background run works inside a project that has a brand, and it produces
something a brand applies to — a rendered page, an email draft, a document, a
design canvas — a check reads the result against the brand and hands concrete
deviations back to the agent once. "The heading uses #ff0000; the brand primary
is #1f4ed8" is the kind of note it gives, not "make it nicer".

It runs only after the completeness check has passed. A run that did not finish
its work is not told about its colours.

It is deliberately soft. It never fails a run that could not be checked — no
model available, no brand, nothing brand-shaped in the output — because the work
is already done and a colour is not worth undoing it for. Where the brand is
enforced *hard* is the frame: the email shell, notification templates and the
branded-HTML tool build their chrome from the brand deterministically, and no
agent can talk them out of it.

It shares one hand-back per run lineage with the completeness check, so the two
together can never bounce a run back and forth. Turn it off with
`agent.brandCriticEnabled: false`.
