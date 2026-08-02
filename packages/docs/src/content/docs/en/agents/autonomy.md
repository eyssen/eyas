---
title: Autonomy
description: How much agents may do without asking — flags, approvals, dashboard.
---

**Routes:** `/autonomy` and Settings → **Autonomy features**.

Autonomy controls **unattended** behaviour: heartbeats, self-improvement, identity updates, and what requires **human approval**.

## Principles

1. Powerful loops are **off by default** (see Dashboard nudge).  
2. Approvals surface under Dashboard **Needs attention** and conversation **Waiting approval**.  
3. Config may also gate identity self-update (`autonomy.identitySelfUpdate` in YAML).

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
| Needs attention → Approval | Pending approval items |
| Agent status waiting_approval | Run blocked on you |

## Related

- [Dashboard](/docs/en/daily/dashboard/)
- [Forge](/docs/en/agents/forge/)
- [Proactive assistant](/docs/en/automation/proactive/)
- [Security & privacy](/docs/en/admin/security-privacy/)
