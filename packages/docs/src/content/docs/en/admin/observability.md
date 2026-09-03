---
title: Observability & ops
description: Token telemetry, traces, cost, God Mode races, and prompt-context cost.
---

**What this is for.** Observability (`/observability`) is the telemetry surface for this instance: traces, cost, latency, anomalies, ensemble (God Mode) races, and what the model actually received. **Ops** (`/ops`) is remediation. Hands, remote nodes, extensions, and notification preferences are **not** on this page — they have their own chapters.

| Area | Route | Meaning |
|------|-------|---------|
| Observability | `/observability` | Metrics / tracing UI — tabs **Usage**, **God Mode**, **Context** |
| Ops | `/ops` | Kubernetes ops agent — observe → diagnose → propose → approve → apply. Default **propose-only**. Cluster URL, kubeconfig, and GitOps repo are instance config, not product defaults. |

Elsewhere (not this page): [Hands](/docs/en/admin/hands/) (`/hands`), [Remote nodes](/docs/en/admin/nodes/) (`/nodes`) — including guarded SSH invoke, [Ingress](/docs/en/admin/ingress/) (`/ingress`), [Extensions](/docs/en/admin/extensions/) (`/extensions`), [Notifications](/docs/en/admin/notifications/) (`/notifications-settings`).

### Usage tab

**Usage** is token telemetry: **Total Traces**, **Total Cost**, **Avg Latency**, **Anomalies**, daily cost, model distribution, and the trace table (timestamp, model, provider, tokens, cost, latency, tools, quality).

### God Mode tab

`/observability` has three tabs: **Usage** (existing traces / stats), **God Mode**, and **Context**. The God Mode tab lists ensemble runs (conversation, winner, model count, cost, duration, whether a tie was broken), win-rate by model, and the average cost multiple versus a single model. Click a run to open that conversation’s God tab (step log, who voted for whom, and each model’s comments on the others).

How a race is set up, how the winner is chosen, and how to read the conversation God tab: [Conversations — God Mode](/docs/en/daily/conversations/#god-mode).

### Context tab

The **Context** tab answers a question nothing in EYAS could answer before: what the model *actually* received, not what was meant to be sent. It shows the average and peak token cost of each prompt section (and how many samples that rests on), truncation frequency (how often — and which section — gets cut to fit budget), and estimate vs. actual: the gap between the token estimate and what the provider reported, the first way to measure how far that estimate drifts.

Detailed per-section records are short-lived by design (7 days by default); only the daily rollup survives long-term. If you go looking for older detail and can't find it, that's expected, not data loss.

## Related

- [Mission Control](/docs/en/agents/runs/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Security](/docs/en/admin/security-privacy/)
- [Settings overview](/docs/en/admin/settings/)
- [Hands](/docs/en/admin/hands/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Extensions](/docs/en/admin/extensions/)
- [Notifications](/docs/en/admin/notifications/)
