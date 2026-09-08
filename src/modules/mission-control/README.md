# Mission Control

Live dashboard for all currently-running agent sessions — Cursor 2.0-style grid
view with per-agent progress, token usage, cost, latest action, status, and
interrupt/pause/resume controls.

## Architecture

```
agent module ──▶ AgentSessionRegistry  ┐
                                       ├──▶ Aggregator ──▶ thin WS ping
event-store ───▶ EventStore            │                └─▶ REST /snapshot
                                       │
bus ──(session.started / tool_called /
      state_changed / approval /
      completed / failed / cancelled,
      plus eyas.agent.run.*) ──────────┘
```

### Aggregator

- Pulls live run data from the injected `AgentSessionRegistry`
  (`session-registry-adapter.ts` in the agent module, over `agent_sessions`).
- Reads the latest event per session from `EventStore` to derive
  `currentAction` (e.g. `"Executing tool: web_search"`) and pending
  approvals.
- Subscribes to the `agent.session.*` subjects **and** `eyas.agent.run.*`
  (what the run supervisor actually emits) and rebuilds the snapshot.
- Throttles deliveries to **max 1 update / 250 ms** per subscriber with
  a trailing-edge debounce, so UI stays smooth under tool-call storms.

### Live updates

There is deliberately **no dedicated Mission Control socket**. `index.ts`
subscribes the aggregator and broadcasts a thin `mission-control` ping on the
shared WS registry; the client refetches `/snapshot`, which is the only place
the per-owner visibility filter is applied. Pushing snapshots down a topic
would hand every subscriber the unfiltered grid — topic subscription is
authenticated but not permission-scoped.

### Routes

| Method | Path                                                            |
| ------ | --------------------------------------------------------------- |
| GET    | `/api/v1/mission-control/snapshot`                              |
| POST   | `/api/v1/mission-control/agents/:sessionId/interrupt`           |
| POST   | `/api/v1/mission-control/agents/:sessionId/pause`               |
| POST   | `/api/v1/mission-control/agents/:sessionId/resume`              |

## Permissions

Subject: `AgentSession`. Verbs: `read`, `interrupt`, `pause`, `resume`.
Defaults:

| Role  | Read | Interrupt | Pause | Resume |
| ----- | ---- | --------- | ----- | ------ |
| owner |   x  |     x     |   x   |   x    |
| admin |   x  |     x     |   x   |   x    |
| user  |   x  |           |       |        |

Non-admins can only interrupt/pause/resume **their own** sessions. This is
enforced in `routes.ts` by comparing `ownerUserId` on the registry entry
to the authenticated user id.

## Frontend

Grid view at `/mission-control`. REST snapshot + WS ping refetch. Each card
shows:

- Agent name + color-coded status badge
- Turn counter (`7 / 20`), token progress (`15.2K / 50K`), cost (`$0.23`)
- Current action (truncated, tooltip on hover)
- Last-event timestamp (relative)
- Interrupt / pause / resume buttons (disabled if user lacks permission)

Totals bar across the top: running, waiting approval, completed today,
cost today.

## Dependencies

- `event-store` (required) — reads latest events per session.
- `permissions` (required) — registers the `AgentSession` subject.
- `agent` (optional) — provides the session registry at runtime via
  `ctx.agentRegistry`. Module starts cleanly without it (shows empty
  dashboard).
