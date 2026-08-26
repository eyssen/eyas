---
title: Proactive assistant
description: Heartbeat-driven suggestions, alerts, and SLA signals.
---

**Route:** `/proactive` (and Dashboard alerts).

When enabled under [Autonomy](/docs/en/agents/autonomy/), EYAS periodically evaluates whether to notify you or act (within policy). Alerts appear as Dashboard **Needs attention → Alert** items.

Keep loops **off** until you understand approval and security settings.

---

## Heartbeat & SLA

The proactive heartbeat can emit **SLA breach** signals (`slaBreaches`) when work drifts:

| Signal kind | Typical meaning |
|-------------|-----------------|
| **Overdue** | Conversation / activity past due date |
| **Stale** | Conversation idle too long while still open / working |

Treat these as operator attention surfaces — combine with Board priority and [Home](/docs/en/daily/home/) setup recommendations.

---

## Related

- [Autonomy](/docs/en/agents/autonomy/)
- [Home](/docs/en/daily/home/)
- [Conversations](/docs/en/daily/conversations/)
