# event-store

Phase 3A — Event Sourcing + Replay infrastructure for EYAS agents.

Inspired by the [OpenHands V1 SDK](https://github.com/All-Hands-AI/OpenHands)
event-sourced runtime: every significant agent action (tool call, LLM call,
state transition, approval, checkpoint) is recorded as a tagged event in
an append-only log. Session state is reconstructed deterministically by
folding events in (seq ASC) order.

## Why event sourcing?

- **Replayability** — any agent session can be rebuilt byte-for-byte from
  events; no "hidden" in-memory state. Tool results are recorded verbatim
  and are never re-executed on replay.
- **Audit** — the event log is the ground truth. Downstream modules
  (audit, observability, privacy) can derive views from it rather than
  maintain parallel logs.
- **Time travel** — `replay(sessionId, { toSeq })` returns the state as
  of any past point.
- **Fast-forward** — snapshots materialise state every N events so replay
  on long sessions stays cheap.

## Module surface

```ts
import { createEventStoreServices } from '@modules/event-store'

const { events, replay, snapshots } = createEventStoreServices(db)

// Append (seq assigned automatically, monotonic per sessionId)
const seq = await events.append({
  sessionId: 'sess-123',
  type: 'ToolCall',
  actor: 'agent:claude',
  payload: { toolName: 'bash', input: { cmd: 'ls' }, toolUseId: 'tu-1' },
})

// Replay to reconstruct state
const state = await replay.replay('sess-123')
// → { messages, toolCalls, pendingApprovals, tokensUsed, currentState, ... }

// Snapshot every 100 events
if (await snapshots.shouldSnapshot('sess-123')) {
  await snapshots.createSnapshot('sess-123')
}
```

## Event types

| Type                | Purpose                                        |
| ------------------- | ---------------------------------------------- |
| `ToolCall`          | Agent invokes a tool                           |
| `ToolResult`        | Tool returns (output recorded verbatim)        |
| `LlmCall`           | LLM request (messages hashed, not stored full) |
| `LlmResponse`       | LLM response content and token usage           |
| `StateTransition`   | Agent FSM transition (e.g. idle→working)       |
| `ApprovalRequested` | User approval gate opened                      |
| `ApprovalGranted`   | User granted pending approval                  |
| `Checkpoint`        | Marker referring to a snapshot                 |

Payloads are validated by Zod schemas in `types.ts`. Unknown types are
accepted as extensions and flow through replay without mutating semantic
state (only `lastSeq` / `eventCount` advance).

## Schema

```
agent_events(id, session_id, seq, ts, event_type, actor, payload JSON)
  UNIQUE(session_id, seq)   -- enforces monotonicity at the DB

agent_snapshots(id, session_id, seq, ts, state JSON, event_count)
```

## Integration points (producers)

Other modules should call `eventStore.events.append(...)` at these
boundaries — documented here, **not yet wired in**:

- `agent` — every tool-call dispatch + result
- `model` gateway — every LLM request + response (messages should be
  hashed, not stored full, to keep the log compact)
- `security-gate` — approval request / grant
- `scheduler` — state transitions on agent lifecycle
- `a2a` — inbound/outbound peer messages as tagged events

None of those modules are touched by this phase; it is pure scaffolding.

## HTTP

| Method | Path                                       |
| ------ | ------------------------------------------ |
| GET    | `/api/v1/events/:sessionId`                |
| GET    | `/api/v1/events/:sessionId/latest`         |
| GET    | `/api/v1/events/:sessionId/replay`         |
| POST   | `/api/v1/events/:sessionId/snapshot`       |
| GET    | `/api/v1/events/:sessionId/snapshot`       |

Permission middleware is intentionally **not** applied yet — the bootstrap
module is providing an unauthenticated surface to keep this phase
self-contained. Wiring to CASL belongs in a follow-up.
