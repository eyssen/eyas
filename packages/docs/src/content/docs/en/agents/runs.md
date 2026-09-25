---
title: Runs & Mission Control
description: Supervise live agent runs — cancel, resume, retry — and watch the live ops board.
---

**What this is for.** **Agent Runs** is the table of executions: live and finished, with status, verification, turns, tokens, and actions. **Mission Control** is the live ops board of agent cards — who is running, waiting on you, or finished. Use the table for history and recovery; use Mission Control for a glance at now.

## When to use it

- A run is stuck, hit max turns, or failed — you want **Resume** (checkpoint) or **Retry** (from the goal).
- Something is running and you need **Cancel** without opening the conversation.
- You want to see whether the completeness critic marked **Goal met** / **Goal not met**.
- You need totals: running, waiting approval, completed today, cost today.
- You want to interrupt a run or open its conversation from a live card.

## Typical workflow

1. Open **Agent Runs** in the sidebar (**AI** section) — route `/agent-runs`. Or **Mission Control** under **Monitoring** — route `/mission-control`.
2. On Agent Runs, scan **Status** and **Verification**. For an active row, **Cancel**; for a failed, stuck, cancelled or max-turns row, **Resume** or **Retry**.
3. On Mission Control, read the totals strip, then act on a card (**Interrupt**, **Open conversation**).
4. The row or card changes status live (WebSocket). Opening the conversation shows the same run's progress, run tree, and tool calls.

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
| **Last progress** | Time since the last heartbeat |
| **Actions** | **Cancel** (running, stuck, refreshing) · **Resume** · **Retry** (failed, stuck, cancelled, max turns) |

### Statuses

| Status | Meaning |
|--------|---------|
| **Running** | In progress |
| **Stuck** | No progress — cancellable / retryable |
| **Refreshing** | Warm resume in flight |
| **Waiting approval** | Parked on an autonomy approval |
| **Completed** | Finished |
| **Max turns** | Hit the turn budget without finishing — resume or retry |
| **Failed** | Error |
| **Cancelled** | Stopped |

### Verification

| Badge | Meaning |
|-------|---------|
| **Goal met** | A reviewer model checked the output against the goal and found it achieved |
| **Goal not met** | The goal was not achieved; the gaps were handed back to the agent once |
| **Unverified** | Could not be checked (no reviewer model, or nothing recorded) |

**Unverified** also appears when no background model could run the check (for example a Grok-only install whose isolation is not verified yet), when the model budget is stopped, or when every attempt failed; the run itself still completes normally.

**Evidence the critic accepts.** When a run's goal needs sources (research, look up, cite, implement, fix, refactor…), the critic looks for grounding, and judges every model the same way:

- **Memory EYAS delivered to the run counts as evidence**, whichever provider or model ran it. The reviewer model is told which memory items were delivered and judges whether the answer is grounded.
- **Tool evidence comes from EYAS's own tool execution log**, not only from the names the provider reports, so a `memory_search` made through the Claude Code or Grok/Kimi bridge counts the same as a native call.
- `memory_expand` counts as retrieval evidence too.

A run with no delivered memory, no retrieval tool call and no `[source:…]` citation is marked **Goal not met** when its goal needs sources. The completeness critic, and the rubric plan written for complex background goals, run as one short isolated call on EYAS's background model — no tools, no conversation history (see [Routing & budget — The background model](/docs/en/ai/routing-budget/#background-model)). Without such a model, no rubric plan is written.

### Resume and Retry on every provider

**Resume** continues from the last checkpoint (do-not-repeat guard). **Retry** re-plans from the goal; already-executed destructive calls stay guarded. Both work the same way for runs on Claude Code, Grok CLI and Kimi CLI as for API providers:

- EYAS records the tools a CLI ran on its own (shell commands, file writes and edits, EYAS tools it called) in the run's history and in its tool execution log, under the names EYAS uses (Bash appears as `run_command`, and so on).
- After a turn in which the CLI ran tools, and whenever a run stops to wait for an approval, EYAS saves a checkpoint: the conversation so far plus what the model answered.
- Resume or Retry continues from that checkpoint, and the model gets a recap of the tools already executed.
- If the model tries to repeat a destructive call that the original run already completed successfully, EYAS refuses it before the CLI runs it: *already executed on the original run — duplicate side effect prevented*. The same call with different arguments, or a call that failed the first time, is allowed. File edits and moves made by a CLI are covered too.
- The same guard covers EYAS tools that Grok and Kimi call through the tool bridge: a resumed or retried run that repeats an EYAS tool call the original run already completed (for example sending the same e-mail or invoice) is refused before it runs, and the tool row shows **Skipped** with that reason. The same tool with other arguments still runs. Proven on the installed Grok CLI; how a real Kimi binary reports these calls has not been verified on a host yet.
- In a background run on Grok or Kimi, an EYAS tool call in a category at **Notice** or **Approve**, or one the security gate escalates (even at **Auto**), waits for approval; the supervised run pauses as **Waiting approval** once the CLI's turn ends, and approving lets exactly that call run once. See [Autonomy](/docs/en/agents/autonomy/).

### How a run ends

- A run that reaches its turn limit ends normally with the status **Max turns**, and the partial answer is kept.
- A run that uses up its tool-call budget also ends normally; its status stays **Completed**.
- A model's own turn-limit, length or refusal stop is an outcome, not an error.
- A tool call that never ran is not reported as a success. The reason is one of: skipped by the per-turn limit, skipped by the run's tool budget, skipped as a duplicate on resume, refused by the security gate, or waiting for approval. The chat shows each as its own status on the tool row, a badge under the reply shows how the turn ended, and a call waiting for approval raises an approval card in the conversation as well as an entry in the [Approvals](/docs/en/agents/autonomy/) queue — see [Conversations — Turn outcome](/docs/en/daily/conversations/#turn-outcome).
- When a run ends with an answer, durable-memory capture runs on it — for background, specialist, delegated, pipeline, A2A and team-member runs as for chat turns, under the same `memory.capture.*` settings. A run that answered nothing writes no capture row, and the capture ledger records which path a row came from (`entry_path`). See [Memory — Capture is on by default](/docs/en/knowledge/memory/#capture-is-on-by-default).

## Mission Control

**Route:** `/mission-control`. Subtitle: *Live view of all running agents.* Empty: *No agents are running.* Banner **Disconnected — reconnecting…** when the socket is down.

### Totals

| Metric | Meaning |
|--------|---------|
| **Running** | Live now |
| **Waiting approval** | Parked on you |
| **Completed today** | Throughput today |
| **Cost today** | Spend today |

Cards sort waiting-approval first, then running, paused, idle, failed, completed, cancelled; within a status, the most recently updated first.

| Card element | Meaning |
|--------------|---------|
| Status | **Idle · Running · Waiting approval · Paused · Completed · Failed · Cancelled** |
| **Turn / Tokens / Cost** | Usage |
| ↳ *parent* | The run was started by another run |
| *N pending approval(s)* | Queue on this session |
| **Interrupt** | Stops the run after a confirmation (*Interrupt this agent?*). Only while it is running, and only for the user who started it or an owner or admin |
| **Open conversation** | Jump to the thread |

The card has no pause or resume control. To continue a stopped run, use **Resume** or **Retry** on Agent Runs.

## Inside a conversation

While a run is active you also see:

- Agent progress (*Step N / Max* where the provider reports steps, otherwise *Tool calls: N*; tokens summed over the run; Cancel)
- Run tree / workflow — for every provider, with status and the run's cost
- Tool call expanders, turn outcome badges and approval cards

Documented under [Conversations](/docs/en/daily/conversations/).

A run works in its conversation's working folders. A conversation without folders of its own has its own EYAS workspace, which it gets when it is created or, for older conversations, on the next message — a run never picks a folder by itself. See [Conversations — Folders](/docs/en/daily/conversations/#working-folders).

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Home — Now running](/docs/en/daily/home/)
- [Autonomy](/docs/en/agents/autonomy/)
