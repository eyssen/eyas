---
title: Autonomy
description: Set how much agents may do without asking — approval queue and three levels.
---

**What this is for.** Autonomy is the safety dial. Per class of action you choose **Notice** (ask first), **Approve** (propose + one-click), or **Auto** (do it and report). Outbound and irreversible actions stay locked at Notice. The same page is the **pending approvals** queue that parks a run until you decide.

## When to use it

- A conversation is **Waiting approval** and you need to **Approve** or **Reject** without guessing what is parked.
- You want reversible work (file edits, research) to run at **Auto**, but never raise a locked outbound class.
- A resume failed after you already approved — the stuck row still needs you.
- You want to turn heartbeats, Forge proposals, or identity self-update on or off as feature flags.

## Typical workflow

1. Open **Autonomy** in the sidebar (**Monitoring** section) — route `/autonomy`. Feature flags live under **Settings → System** (Autonomy features card).
2. Read **Pending approvals**. For each row, **Approve** or **Reject**. Follow **Run waiting on this** into the conversation if you need context.
3. Under **Reversible**, set a category to **Notice / Approve / Auto** (locked categories cannot go above Notice).
4. The parked run should resume (or stay stopped on reject). Home **Attention** and the conversation **Waiting approval** badge should clear.

## Features

Autonomy controls **unattended** behaviour: how much an agent may do per class of action, and what requires **human approval**. Powerful loops stay **off by default**.

## Principles

1. Powerful loops are **off by default** (see Dashboard nudge).  
2. Approvals surface under Dashboard **Needs attention** and conversation **Waiting approval**.  
3. Config may also gate identity self-update (`autonomy.identitySelfUpdate` in YAML).

## Approval queue and levels

**Route:** `/autonomy`. Subtitle in the app explains that irreversible / outbound actions are locked at **Notice**.

### Pending approvals

| Control | Meaning |
|---------|---------|
| **Pending approvals** | Queue of parked requests |
| *Nothing waiting for approval.* | Empty queue |
| Category · tool | What is being asked |
| Reason | Why the gate fired |
| **Run waiting on this** | Link to the parked run / conversation |
| **Approve / Reject** | Decide — approve tries to resume the run |
| *Could not resume: …* | Approval already decided, but the run did not restart (stuck resume) |

### Levels (per category)

| Level | Label | Hint |
|-------|-------|------|
| 1 | **Notice** | Ask first |
| 2 | **Approve** | Propose + one-click approval |
| 3 | **Auto** | Autonomous + report after |

Categories split into **Reversible** (you may raise the level) and **Outbound / irreversible (locked)** (cannot go above Notice — a safety floor).

## Settings (Autonomy features card)

Enable/disable individual loops such as (names as shown in UI):

| Area | Meaning |
|------|---------|
| Heartbeat / proactive checks | Periodic “is there something to do?” |
| Reflection / briefing | Morning briefing content |
| Forge proposals | Auto-suggested identity/soul changes |
| Self-learning / skill evolution | Learn from usage (still reviewable) |
| Identity self-update | Agent may edit IDENTITY directly vs Forge-only |

Toggle labels live in Settings locales (`autonomy-features-card`). Each toggle is **feature flag only** — it does not delete data.

## Dashboard surfaces

| Surface | Meaning |
|---------|---------|
| Autonomy nudge | Opt-in explanation + link to settings |
| Home **Attention** | Pending approval items and stuck resumes |
| Conversation **Waiting approval** | Run blocked on you |
| Telegram **Approve / Deny** | Same decide path as this queue, for yellow/red tools. Ping goes to the thread's Telegram mapping, else an approved pairing. No raw tool args. See [Telegram](/docs/en/communication/telegram/#approval-ping) |

## Related

- [Home](/docs/en/daily/home/)
- [Forge](/docs/en/agents/forge/)
- [Proactive assistant](/docs/en/automation/proactive/)
- [Security & privacy](/docs/en/admin/security-privacy/)
- [Telegram](/docs/en/communication/telegram/)
