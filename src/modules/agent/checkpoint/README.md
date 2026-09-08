# agent/checkpoint

Phase 3B — Checkpoint / Resume for agent runs.

Inspired by the LangGraph checkpointer pattern: a long-running agent loop
should be pausable and resumable. A checkpoint captures conversation state,
pending tool calls, token usage, and turn counters at a point in time. The
resume engine reconstructs that state so the loop can pick up where it
stopped (crash, cancellation, user pause, or safety gate).

This module is a sibling of [`event-store`](../../event-store/README.md):
the event-store holds the append-only log; a checkpoint is a named pointer
into that log plus a cached state snapshot so resume does not need to
replay from seq=0.

## Why separate from event-store snapshots?

| Concern                | event-store snapshots       | agent checkpoints            |
| ---------------------- | --------------------------- | ---------------------------- |
| Automatic (every N ev) | yes                         | optional (policy-driven)     |
| Named / user-visible   | no                          | yes (`label`, `reason`)      |
| Kind / intent          | n/a                         | `auto` / `manual` / `before_risky_tool` |
| Lifetime               | managed by snapshot manager | explicit prune policy        |
| UI surface             | internal                    | visible in agent run timeline |

A checkpoint can _reference_ an event-store snapshot (`snapshot_ref`) so
resume is O(0) instead of O(events since seq). When the snapshot manager
is wired in, each checkpoint will also trigger a snapshot at the same seq.

## Module surface

```ts
import { createCheckpointServices, createCheckpointTables } from '@modules/agent/checkpoint'

createCheckpointTables(db)

const { api } = createCheckpointServices(db, {
  eventStore: events.events,
  snapshotManager: events.snapshots,
  policy: { everyTurns: 5, beforeRiskyTools: true },
})

// Manual checkpoint
const cp = await api.createCheckpoint({
  sessionId: 'sess-123',
  eventSeq: 42,
  label: 'Before DB migration',
  kind: 'manual',
  reason: 'user paused run',
  state: currentState,
  actor: 'user:krisztian',
})

// List
const list = await api.list('sess-123') // most-recent-first

// Resume
const restored = await api.load(cp.id)
// → { checkpoint, state }

// Retention
await api.prune('sess-123', { keepLast: 20, olderThanDays: 30 })
```

## Data model

```
agent_checkpoints
  id TEXT PRIMARY KEY                 -- ULID
  session_id TEXT NOT NULL
  event_seq INTEGER NOT NULL          -- seq in event-store at checkpoint time
  snapshot_ref TEXT                   -- optional soft link to agent_snapshots.id
  label TEXT NOT NULL                 -- user-visible name
  kind TEXT NOT NULL                  -- 'auto' | 'manual' | 'before_risky_tool'
  reason TEXT                         -- free-form description
  state_blob TEXT NOT NULL            -- JSON: CheckpointState (messages, tool calls, token usage, turn)
  created_at INTEGER NOT NULL
  created_by TEXT NOT NULL
  INDEX (session_id, created_at DESC)
  INDEX (session_id, kind)
```

No foreign keys: checkpoints are independent from the event log by design
so event-store maintenance / compaction does not cascade into checkpoint
deletion.

## Auto-checkpoint policy

The default policy creates a checkpoint:

- Before any turn that dispatches a risky tool (`bash`, `shell`,
  `write_file`, `delete_file`, `db_exec`, `http_call`)
- Every 5 turns

Override via `policy`:

```ts
createCheckpointServices(db, {
  policy: {
    everyTurns: 10,
    beforeRiskyTools: true,
    riskyToolNames: ['bash', 'write_file', 'odoo_write'],
  },
})
```

## Retention defaults

`api.prune(sessionId, opts)`:

- `keepLast: 20` — recommended default. Always preserves the 20 newest
  checkpoints regardless of age.
- `olderThanDays: 30` — recommended default. Among the non-preserved
  candidates, only deletes those older than 30 days.

Callers can tune or drop `olderThanDays` to enforce purely count-based
retention.

## Integration with event-store

Two resume paths are supported by `resume-engine`:

1. **Cold resume** — the checkpoint was created right before the session
   stopped. `state_blob` is authoritative; no follow-up events exist.
2. **Warm resume** — the session appended events after the checkpoint
   before crashing (e.g. a tool result came in, but the loop died before
   the next LLM call). The resume engine folds those events on top of
   `state_blob` using the event-store's `applyEvent`.

Both paths are handled transparently by `api.load(checkpointId)` when the
event-store is wired into `createCheckpointServices(db, { eventStore })`.

## Integration snippet for agent-runner (copy-paste-ready)

Apply this in a later session. **Do not modify `agent-runner.ts` from this
phase.**

```ts
// inside the agent run loop, after the turn counter is known and before
// the next tool dispatch:

if (checkpoints.api.shouldAutoCheckpoint(sessionId, turn, { upcomingTool })) {
  await checkpoints.api.createCheckpoint({
    sessionId,
    eventSeq: await eventStore.latestSeq(sessionId),
    label: `Auto checkpoint (turn ${turn})`,
    kind: upcomingTool ? 'before_risky_tool' : 'auto',
    reason: upcomingTool ? `about to run ${upcomingTool}` : undefined,
    state: {
      ...agentState,
      turn,
    },
    actor: agentId,
  })
}

// at resume:
const restored = await checkpoints.api.load(checkpointId)
if (!restored) throw new Error('checkpoint missing')
agentState = restored.state
turn = restored.state.turn ?? 0
```

## HTTP

Not wired in this phase — the module is pure infrastructure. A follow-up
will expose `/api/v1/checkpoints/:sessionId` once CASL permissions for
`checkpoint:read` / `checkpoint:create` / `checkpoint:prune` are defined.
