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
