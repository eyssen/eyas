---
title: Proactive assistant
description: Heartbeat-driven alerts, insights, and learned lessons — the assistant that surfaces work.
---

**What this is for.** The proactive assistant watches for work that needs you: overdue conversations, stale threads, anomalies, opportunities, reminders. It does not replace the Board or Home. Home's **Attention** tile can show the same alerts; this page is the full list plus **Learned Lessons**. Keep the heartbeat **off** until you understand approval and spend — it makes paid model calls on a schedule.

**Route:** `/proactive`. Title: **Proactive Dashboard**. Subtitle: *Active alerts, insights, and learned patterns.* Also surfaces on Dashboard **Needs attention → Alert** items.

## When to use it

- You want EYAS to nudge you when work is overdue or a conversation has gone stale.
- You enabled **Proactive heartbeat** under Autonomy and need the operator surface for what it found.
- You want a one-shot **Check Now** instead of waiting for the next heartbeat.
- You are reviewing lessons the assistant learned from earlier alerts.

## Typical workflow

1. Enable **Proactive heartbeat** under [Autonomy](/docs/en/agents/autonomy/) (Settings → Autonomy & self-improvement) only if you want background spend.
2. Open **Proactive** in the sidebar (`/proactive`).
3. Read **Active Alerts**. Priority badges: **Urgent / High / Normal / Low**. Types: anomaly, opportunity, reminder, insight.
4. Press **Check Now** to run an evaluation immediately. Empty state: *All clear — no active alerts*.
5. Scroll to **Learned Lessons** for patterns the assistant already applied (confidence %).

## Features

When enabled under Autonomy, EYAS periodically evaluates whether to notify you or act (within policy). Alerts appear here and as Home **Attention** items.

**The briefing text** is written by EYAS's background model in one isolated call: the **Heartbeat** routing tier (primary, then fallback), then the install default, then API providers, then CLIs that can run isolated calls — never a provider the gateway picks on its own, and never a CLI running with its own tools and memory. When no model qualifies (for example a Grok-only or Kimi-only install before their isolation is verified) or the budget is at *stop*, EYAS makes no model call and sends the canned alert *Heartbeat: items may need your attention* with the list of reasons. See [Routing & budget — The background model](/docs/en/ai/routing-budget/#background-model).

**Background runs get the same memory as chat.** When the heartbeat or a board card starts a background run, that run receives the same recalled-memory block, with the current date and time, as a chat turn (see [Memory — How recall reaches the model](/docs/en/knowledge/memory/#how-recall-reaches-the-model)). A card's goal is also remembered — once per distinct goal, however often the run is retried — as text EYAS wrote, not yours.

**One runner for background runs.** Cards in bot-listen or auto-assignee stages, and `assign_task` cards, run with the same setup as a retry of the same card, a [scheduled agent routine](/docs/en/automation/scheduler/#agent-routines-run-in-a-conversation) and a colleague started by a hand-off: supervised, autonomous and gated by the autonomy ladder, on the card's model, with memory recall, attached designs, documents, durable-memory capture and the completeness critic. Board runs now also get designs, documents and durable-memory capture, which they lacked before. A background card always takes its provider and model from one binding, never a card's provider combined with an agent's model from another provider.

The heartbeat can emit **SLA breach** signals (`slaBreaches`) when work drifts.

| Signal kind | Typical meaning |
|-------------|-----------------|
| **Overdue** | Conversation / activity past due date |
| **Stale** | Conversation idle too long while still open / working |

Treat these as operator attention surfaces — combine with Board priority and [Home](/docs/en/daily/home/) setup recommendations.

## Fields and controls

<h2 id="alerts">Active Alerts</h2>

| Control | Meaning |
|---------|---------|
| **Check Now** | POST `/proactive/check` — run an evaluation now |
| **N urgent** | Count of urgent + high alerts |
| Priority badge | **Urgent / High / Normal / Low** |
| Type | anomaly · opportunity · reminder · insight |
| Title / body | Alert copy |
| Optional action button | Label from the alert (`actionLabel`) — opens the related URL when present |
| Timestamp | When the alert was created |

<h2 id="lessons">Learned Lessons</h2>

| Field | Meaning |
|-------|---------|
| Title / summary | Lesson copy |
| **N% confidence** | How sure the assistant is |
| Applied at | When it was applied, if present |

Empty: *No lessons learned yet.*

## Related

- [Autonomy](/docs/en/agents/autonomy/)
- [Home](/docs/en/daily/home/)
- [Conversations](/docs/en/daily/conversations/)
- [Self-learning](/docs/en/automation/self-learning/)
- [Scheduler](/docs/en/automation/scheduler/)
