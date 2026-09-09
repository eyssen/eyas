# EYAS Workflows — P0-backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend half of the `/workflows`-style live tree: a normalized `OrchestrationEvent` pipeline that the EYAS orchestrator emits and broadcasts to the browser over the existing generic WebSocket.

**Architecture:** A pure event model + adapter in `src/shared`; a thin `OrchestrationBroadcaster` over the existing `WSConnectionRegistry.broadcast` (the bus→WS bridge is dead because `local-bus` is exact-match only, so we broadcast directly, exactly as Mission Control and notifications do); the `team-session`/`orchestrator`/`routes-team` path emits normalized events (including per-subagent live progress) and fixes the empty-goal bug in passing.

**Tech Stack:** Bun, TypeScript (strict, ESM), Drizzle (bun:sqlite), Vitest.

Spec: `docs/superpowers/specs/2026-07-08-eyas-workflows-hybrid-orchestration-design.md` (§4.1, §4.2, §4.5). Frontend (`run-tree-store` + `<RunTree>`) is the sibling plan **P0-frontend**, written after reading the frontend store/hook conventions.

## Global Constraints

- English code + comments; Hungarian business comments where helpful.
- ESM, TypeScript strict. No `console.log` in production code — use the injected logger (Pino).
- Zod for external input validation. CSS variables only (frontend plan).
- `/api/v1/` prefix for API endpoints. MIT-compatible deps only — add none in P0.
- **Version stays frozen** — do NOT touch `version.json`, `package.json` version, or HTML version strings.
- **3 schema sources**: any new DB column MUST be added to production DDL **and** the test schemas (`tests/**/test-db.ts`, `tests/**/test-eyas.ts`) — they diverge; missing one makes tests pass while prod breaks (or vice-versa). Grep for the table name across all three before finishing a schema task.
- Default `bun vitest run` must stay green offline (e2e excluded via `vitest.e2e.config.ts`).
- **No auto-commit / no branch / no push.** The "Commit" step in each task is a checkpoint: **stop and ask the user** before running it. Work on `main`.
- File header on new `src` files: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`

## File Structure

- `src/shared/orchestration-events.ts` — **new.** The `OrchestrationEvent` type, a per-run sequence counter, and the pure `orchestratorEventToOrchestration` adapter. Zero deps on modules → unit-testable in isolation.
- `src/modules/agent/orchestration-broadcaster.ts` — **new.** `OrchestrationBroadcaster` interface + `createOrchestrationBroadcaster(registry)` impl over `WSConnectionRegistry.broadcast`.
- `src/modules/agent/team-session-service.ts` — **modify.** Persist `goal_description` on `team_sessions`; expose it on `TeamSession`.
- `src/modules/agent/orchestrator.ts` — **modify.** `runAgentInConversation` accepts an `onProgress` callback and emits `node_started` (with the REAL child conversationId) + `node_progress` + `node_completed`.
- `src/modules/agent/routes-team.ts` — **modify.** Approve loop passes the persisted goal into `executeTeam` and broadcasts adapted `OrchestrationEvent`s via the broadcaster.
- `src/modules/agent/index.ts` — **modify.** Construct the broadcaster from the WS registry and inject it into `createTeamRoutes`.
- Tests under `tests/shared/` and `tests/modules/agent/`.

---

### Task 1: Normalized event model + pure adapter

**Files:**
- Create: `src/shared/orchestration-events.ts`
- Test: `tests/shared/orchestration-events.test.ts`

**Interfaces:**
- Consumes: `OrchestratorEvent` (from `src/modules/agent/orchestrator.ts:197`) — shape reproduced below.
- Produces:
  - `type OrchestrationEvent` (see code).
  - `function createRunSeq(): () => number` — monotonic counter starting at 1.
  - `function orchestratorEventToOrchestration(runId: string, ev: OrchestratorEvent, seq: number): OrchestrationEvent | null` — maps team-level transitions; returns `null` for events with no tree meaning (`replan_result`, `phase_completed`).

For reference, the source `OrchestratorEvent` union is:
```ts
type OrchestratorEvent =
  | { type: 'team_proposed'; proposal: TeamProposal }
  | { type: 'phase_started'; phase: string; agents: string[] }
  | { type: 'agent_started'; agentId: string; conversationId: string; phase: string }
  | { type: 'agent_completed'; agentId: string; conversationId: string; status: 'completed' | 'failed' }
  | { type: 'phase_completed'; phase: string; results: PhaseResult }
  | { type: 'replan_result'; result: RePlanResult }
  | { type: 'checkpoint'; phase: string; message: string }
  | { type: 'team_completed'; totalTokens: number; totalCostUsd: number }
  | { type: 'team_failed'; error: string }
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/orchestration-events.test.ts
import { describe, it, expect } from 'vitest'
import {
  createRunSeq,
  orchestratorEventToOrchestration,
  type OrchestrationEvent,
} from '@shared/orchestration-events.js'

describe('createRunSeq', () => {
  it('produces a monotonic sequence starting at 1', () => {
    const next = createRunSeq()
    expect([next(), next(), next()]).toEqual([1, 2, 3])
  })
})

describe('orchestratorEventToOrchestration', () => {
  it('maps phase_started to node_started for the phase root', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'phase_started', phase: 'Build', agents: ['a1'] }, 5)
    expect(out).toMatchObject({
      runId: 'run1',
      seq: 5,
      nodeId: 'phase:Build',
      parentId: null,
      payload: { type: 'node_started', kind: 'agent', label: 'Build' },
    })
  })

  it('maps agent_started (empty conversationId) to a provisional node keyed by agent+phase, parented to the phase', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'agent_started', agentId: 'a1', conversationId: '', phase: 'Build' }, 6)
    expect(out).toMatchObject({
      nodeId: 'agent:Build:a1',
      parentId: 'phase:Build',
      payload: { type: 'node_started', kind: 'subagent', label: 'a1', agentId: 'a1' },
    })
  })

  it('maps agent_completed to node_completed on the same provisional node, carrying the real conversationId', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'agent_completed', agentId: 'a1', conversationId: 'conv9', phase: undefined as any }, 7)
    // agent_completed has no phase field; node key falls back to agentId only and reconciliation is by conversationId
    expect(out).toMatchObject({
      nodeId: 'agent::a1',
      payload: { type: 'node_completed', status: 'completed', conversationId: 'conv9' },
    })
  })

  it('maps team_completed to run_completed', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'team_completed', totalTokens: 42, totalCostUsd: 0.1 }, 8)
    expect(out).toMatchObject({ payload: { type: 'run_completed', status: 'completed', totalTokens: 42, totalCostUsd: 0.1 } })
  })

  it('maps team_failed to run_completed(failed)', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'team_failed', error: 'boom' }, 9)
    expect(out?.payload).toMatchObject({ type: 'run_completed', status: 'failed' })
  })

  it('maps checkpoint to a checkpoint payload', () => {
    const out = orchestratorEventToOrchestration('run1', { type: 'checkpoint', phase: 'Build', message: 'approve?' }, 10)
    expect(out?.payload).toMatchObject({ type: 'checkpoint', message: 'approve?' })
  })

  it('returns null for events with no tree meaning', () => {
    expect(orchestratorEventToOrchestration('run1', { type: 'phase_completed', phase: 'Build', results: {} as any }, 11)).toBeNull()
    expect(orchestratorEventToOrchestration('run1', { type: 'replan_result', result: {} as any }, 12)).toBeNull()
    expect(orchestratorEventToOrchestration('run1', { type: 'team_proposed', proposal: {} as any }, 13)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/shared/orchestration-events.test.ts`
Expected: FAIL — cannot resolve `@shared/orchestration-events.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/orchestration-events.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { OrchestratorEvent } from '@modules/agent/orchestrator.js'

export type OrchestrationNodeKind = 'root' | 'agent' | 'subagent'

export type OrchestrationPayload =
  | { type: 'run_started'; goal: string }
  | { type: 'node_started'; kind: OrchestrationNodeKind; label: string; agentId?: string; conversationId?: string }
  | { type: 'node_progress'; turn?: number; maxTurns?: number; tokens?: number }
  | { type: 'tool_started'; toolId: string; name: string }
  | { type: 'tool_result'; toolId: string; status: 'success' | 'error'; summary?: string }
  | { type: 'node_completed'; status: 'completed' | 'failed' | 'cancelled'; summary?: string; tokens?: number; conversationId?: string }
  | { type: 'checkpoint'; message: string }
  | { type: 'run_completed'; status: 'completed' | 'failed' | 'cancelled'; totalTokens: number; totalCostUsd: number }

export interface OrchestrationEvent {
  runId: string
  nodeId: string
  parentId: string | null
  seq: number
  payload: OrchestrationPayload
}

/** Monotonic per-run sequence counter (starts at 1). */
export function createRunSeq(): () => number {
  let n = 0
  return () => ++n
}

/**
 * Pure mapping from the orchestrator's team-level event vocabulary to the
 * normalized OrchestrationEvent tree model. Returns null for events that
 * carry no tree meaning.
 *
 * Node keys:
 *   - phase root:      `phase:<phase>`
 *   - agent/subagent:  `agent:<phase>:<agentId>` (phase may be '' when absent)
 * The frontend reducer reconciles the provisional agent node with its real
 * conversationId when node_completed arrives.
 */
export function orchestratorEventToOrchestration(
  runId: string,
  ev: OrchestratorEvent,
  seq: number,
): OrchestrationEvent | null {
  const base = (nodeId: string, parentId: string | null, payload: OrchestrationPayload): OrchestrationEvent => ({
    runId, nodeId, parentId, seq, payload,
  })

  switch (ev.type) {
    case 'phase_started':
      return base(`phase:${ev.phase}`, null, { type: 'node_started', kind: 'agent', label: ev.phase })
    case 'agent_started':
      return base(`agent:${ev.phase}:${ev.agentId}`, `phase:${ev.phase}`, {
        type: 'node_started', kind: 'subagent', label: ev.agentId, agentId: ev.agentId, conversationId: ev.conversationId || undefined,
      })
    case 'agent_completed':
      return base(`agent:${(ev as any).phase ?? ''}:${ev.agentId}`, null, {
        type: 'node_completed',
        status: ev.status === 'failed' ? 'failed' : 'completed',
        conversationId: ev.conversationId || undefined,
      })
    case 'checkpoint':
      return base(`phase:${ev.phase}`, null, { type: 'checkpoint', message: ev.message })
    case 'team_completed':
      return base(runId, null, { type: 'run_completed', status: 'completed', totalTokens: ev.totalTokens, totalCostUsd: ev.totalCostUsd })
    case 'team_failed':
      return base(runId, null, { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 })
    default:
      // team_proposed, phase_completed, replan_result — no tree meaning.
      return null
  }
}
```

Note: verify `@shared` and `@modules` path aliases resolve (they are used across the codebase, e.g. `@shared/crypto.js`, `@modules/permissions/middleware`). If `@modules/agent/orchestrator.js` creates an import cycle warning at build, change the import to `import type` only (already `import type`) — type-only imports are erased and cannot cycle at runtime.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/shared/orchestration-events.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck` (or `bunx tsc --noEmit`)
Expected: no new errors.

- [ ] **Step 6: Commit** — STOP, ask the user before committing.

```bash
git add src/shared/orchestration-events.ts tests/shared/orchestration-events.test.ts
git commit -m "feat(agent): normalized OrchestrationEvent model + adapter"
```

---

### Task 2: OrchestrationBroadcaster over the WS registry

**Files:**
- Create: `src/modules/agent/orchestration-broadcaster.ts`
- Test: `tests/modules/agent/orchestration-broadcaster.test.ts`

**Interfaces:**
- Consumes: `WSConnectionRegistry` (`src/core/http/websocket.ts:18`) — only `.broadcast(topic, { event, data })` is used.
- Consumes: `OrchestrationEvent` (Task 1).
- Produces:
  - `interface OrchestrationBroadcaster { emit(event: OrchestrationEvent): void; topicFor(runId: string): string }`
  - `function createOrchestrationBroadcaster(registry: Pick<WSConnectionRegistry, 'broadcast'>): OrchestrationBroadcaster`
  - Topic format: `orchestration:<runId>`. WS message: `{ event: 'orchestration', data: OrchestrationEvent }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/agent/orchestration-broadcaster.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createOrchestrationBroadcaster } from '@modules/agent/orchestration-broadcaster.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

const evt: OrchestrationEvent = {
  runId: 'run1', nodeId: 'n1', parentId: null, seq: 1,
  payload: { type: 'run_started', goal: 'do it' },
}

describe('createOrchestrationBroadcaster', () => {
  it('broadcasts to the orchestration:<runId> topic with an "orchestration" envelope', () => {
    const broadcast = vi.fn()
    const b = createOrchestrationBroadcaster({ broadcast })
    b.emit(evt)
    expect(broadcast).toHaveBeenCalledWith('orchestration:run1', { event: 'orchestration', data: evt })
  })

  it('topicFor derives the topic', () => {
    const b = createOrchestrationBroadcaster({ broadcast: vi.fn() })
    expect(b.topicFor('abc')).toBe('orchestration:abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/agent/orchestration-broadcaster.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/agent/orchestration-broadcaster.ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import type { WSConnectionRegistry } from '@core/http/websocket.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

export interface OrchestrationBroadcaster {
  emit(event: OrchestrationEvent): void
  topicFor(runId: string): string
}

/**
 * Broadcasts normalized OrchestrationEvents directly to WS subscribers.
 * We do NOT route through the bus→WS bridge: `local-bus` is exact-subject
 * match only (no wildcard expansion), so the bridge's `eyas.*.*` mappings
 * never fire for concrete subjects. Direct broadcast is the working pattern
 * (same as Mission Control and notifications).
 */
export function createOrchestrationBroadcaster(
  registry: Pick<WSConnectionRegistry, 'broadcast'>,
): OrchestrationBroadcaster {
  const topicFor = (runId: string) => `orchestration:${runId}`
  return {
    topicFor,
    emit(event) {
      registry.broadcast(topicFor(event.runId), { event: 'orchestration', data: event })
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun vitest run tests/modules/agent/orchestration-broadcaster.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** — STOP, ask the user first.

```bash
git add src/modules/agent/orchestration-broadcaster.ts tests/modules/agent/orchestration-broadcaster.test.ts
git commit -m "feat(agent): OrchestrationBroadcaster over WS registry"
```

---

### Task 3: Persist the team goal (fixes empty-goal bug)

**Problem:** `routes-team.ts:84` calls `executeTeam(config, session.parentConversationId, '', id)` — the empty string makes every subagent receive an empty goal. The proposal's `goalDescription` is never stored on the session.

**Files:**
- Modify: `src/modules/agent/team-session-service.ts` (schema DDL, `TeamSession`, `toSession`, `create`, `CreateSessionInput`)
- Modify: production DDL + `tests/**/test-db.ts` + `tests/**/test-eyas.ts` for the `team_sessions` table (grep first)
- Test: `tests/modules/agent/team-session-goal.test.ts`

**Interfaces:**
- Produces: `TeamSession.goalDescription: string`; `CreateSessionInput.goalDescription: string`.

- [ ] **Step 1: Locate every `team_sessions` DDL**

Run: `grep -rn "team_sessions" src tests | grep -iE "create table|CREATE TABLE"`
Record each file. The new column: `goal_description TEXT NOT NULL DEFAULT ''`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/modules/agent/team-session-goal.test.ts
import { describe, it, expect } from 'vitest'
import { createTeamSessionService } from '@modules/agent/team-session-service.js'
import { makeTestDb } from '../../helpers/test-db.js' // adjust to the repo's helper path

describe('team session goalDescription', () => {
  it('persists and returns the goal', () => {
    const db = makeTestDb() // must have the team_sessions table with goal_description
    const svc = createTeamSessionService(db)
    const s = svc.create('conv1', { config: { phases: [] }, reasoning: 'r', estimatedTokens: 0, goalDescription: 'Ship the tree' })
    expect(s.goalDescription).toBe('Ship the tree')
    expect(svc.get(s.id)!.goalDescription).toBe('Ship the tree')
  })
})
```

(If the repo has no `makeTestDb` helper, construct the in-memory DB the way the existing `team-session-service.test.ts` does — mirror that setup exactly.)

- [ ] **Step 3: Run test to verify it fails**

Run: `bun vitest run tests/modules/agent/team-session-goal.test.ts`
Expected: FAIL — `goalDescription` is `undefined` / column missing.

- [ ] **Step 4: Add the column to the production DDL and all test schemas**

In the production `team_sessions` DDL add after `parent_conversation_id`:
```sql
goal_description TEXT NOT NULL DEFAULT '',
```
Apply the identical `ALTER`/`CREATE` to `tests/**/test-db.ts` and `tests/**/test-eyas.ts`. For existing DBs, an idempotent migration:
```ts
// wherever team_sessions is created/migrated
db.run(sql`ALTER TABLE team_sessions ADD COLUMN goal_description TEXT NOT NULL DEFAULT ''`)
// guard: wrap in try/catch or check pragma table_info to stay idempotent, per the codebase's migration style
```

- [ ] **Step 5: Thread the field through the service**

```ts
// team-session-service.ts — TeamSession interface: add
goalDescription: string

// CreateSessionInput: add
goalDescription: string

// toSession(): add
goalDescription: raw.goal_description ?? '',

// create(): update INSERT
db.run(sql`INSERT INTO team_sessions
  (id, parent_conversation_id, goal_description, status, config, reasoning, estimated_tokens, total_tokens, total_cost_usd, created_at)
  VALUES (${id}, ${parentConversationId}, ${input.goalDescription}, 'proposing', ${JSON.stringify(input.config)},
          ${input.reasoning}, ${input.estimatedTokens}, 0, 0, ${now})`)
```

- [ ] **Step 6: Set the goal at propose time**

In `routes-team.ts` `POST /conversations/:id/team/propose`, pass the goal into `create`:
```ts
const session = teamSessions.create(conversationId, {
  config: proposal.config,
  reasoning: proposal.reasoning,
  estimatedTokens: proposal.estimatedTokens,
  goalDescription,                    // <-- from the request body
})
```

- [ ] **Step 7: Run the test + the existing team-session suite**

Run: `bun vitest run tests/modules/agent/team-session-goal.test.ts tests/modules/agent/team-session-service.test.ts`
Expected: PASS (new test + all existing green).

- [ ] **Step 8: Commit** — STOP, ask the user first.

```bash
git add src/modules/agent/team-session-service.ts src/modules/agent/routes-team.ts tests/
git commit -m "fix(agent): persist team goalDescription (fixes empty-goal on execute)"
```

---

### Task 4: Broadcast adapted events from the approve loop + pass the real goal

**Files:**
- Modify: `src/modules/agent/routes-team.ts` (`createTeamRoutes` signature + approve loop)
- Modify: `src/modules/agent/index.ts` (construct broadcaster, inject)
- Test: `tests/modules/agent/team-routes-broadcast.test.ts`

**Interfaces:**
- Consumes: `OrchestrationBroadcaster` (Task 2), `createRunSeq` + `orchestratorEventToOrchestration` (Task 1), `TeamSession.goalDescription` (Task 3).
- `createTeamRoutes(app, teamSessions, orchestrator, bus?, broadcaster?)` — `broadcaster` optional so existing callers/tests keep working.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/agent/team-routes-broadcast.test.ts
import { describe, it, expect, vi } from 'vitest'
import { Hono } from 'hono'
import { createTeamRoutes } from '@modules/agent/routes-team.js'
import type { OrchestrationEvent } from '@shared/orchestration-events.js'

function fakeOrchestrator() {
  return {
    async *executeTeam(_config: any, _parent: string, goal: string, _id: string) {
      // assert the real goal is threaded, not ''
      expect(goal).toBe('Ship the tree')
      yield { type: 'phase_started', phase: 'Build', agents: ['a1'] }
      yield { type: 'agent_started', agentId: 'a1', conversationId: '', phase: 'Build' }
      yield { type: 'agent_completed', agentId: 'a1', conversationId: 'c9', status: 'completed' }
      yield { type: 'team_completed', totalTokens: 3, totalCostUsd: 0 }
    },
    analyzeAndPropose: vi.fn(),
  } as any
}

function fakeSessions(goal: string) {
  return {
    get: () => ({ id: 's1', parentConversationId: 'p1', goalDescription: goal, config: JSON.stringify({ phases: [] }) }),
    approve: vi.fn(),
    complete: vi.fn(),
    setStatus: vi.fn(),
  } as any
}

describe('approve loop broadcasts orchestration events', () => {
  it('emits adapted events with monotonic seq and passes the persisted goal', async () => {
    const emitted: OrchestrationEvent[] = []
    const broadcaster = { emit: (e: OrchestrationEvent) => emitted.push(e), topicFor: (r: string) => `orchestration:${r}` }
    const app = new Hono()
    createTeamRoutes(app, fakeSessions('Ship the tree'), fakeOrchestrator(), undefined, broadcaster)

    const res = await app.request('/team-sessions/s1/approve', { method: 'POST' })
    expect(res.status).toBe(200)
    // approve fires background work — flush microtasks
    await new Promise(r => setTimeout(r, 20))

    const types = emitted.map(e => e.payload.type)
    expect(types).toContain('node_started')
    expect(types).toContain('node_completed')
    expect(types.at(-1)).toBe('run_completed')
    // seq is strictly increasing
    const seqs = emitted.map(e => e.seq)
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    // all scoped to the session runId
    expect(emitted.every(e => e.runId === 's1')).toBe(true)
  })
})
```

Note: this test omits the `requirePermission` middleware because `createTeamRoutes` mounts it; if the middleware rejects unauthenticated requests in the bare Hono app, mirror the auth-bypass pattern used by the existing `routes-team.test.ts` (inject a permissive `requirePermission` or set the user context). Check that file first and copy its setup.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/agent/team-routes-broadcast.test.ts`
Expected: FAIL — `createTeamRoutes` has no 5th param / no events emitted.

- [ ] **Step 3: Update `createTeamRoutes`**

```ts
// routes-team.ts — imports
import { createRunSeq, orchestratorEventToOrchestration } from '@shared/orchestration-events.js'
import type { OrchestrationBroadcaster } from './orchestration-broadcaster.js'

// signature
export function createTeamRoutes(
  app: Hono,
  teamSessions: TeamSessionService,
  orchestrator: ReturnType<typeof createOrchestrator>,
  bus?: { emit(subject: string, data: unknown): void },
  broadcaster?: OrchestrationBroadcaster,
) {
```

Replace the approve background loop body:
```ts
    teamSessions.approve(id)

    const config = JSON.parse(session.config)
    const goal = session.goalDescription ?? ''
    const nextSeq = createRunSeq()
    ;(async () => {
      try {
        for await (const event of orchestrator.executeTeam(config, session.parentConversationId, goal, id)) {
          bus?.emit(`team:${id}:event`, event)                       // keep legacy bus emit
          const normalized = orchestratorEventToOrchestration(id, event, nextSeq())
          if (normalized) broadcaster?.emit(normalized)              // NEW: direct WS broadcast
          if (event.type === 'team_completed') {
            const c = event as Extract<OrchestratorEvent, { type: 'team_completed' }>
            teamSessions.complete(id, c.totalTokens, c.totalCostUsd)
          }
          if (event.type === 'team_failed') teamSessions.setStatus(id, 'failed')
        }
      } catch (err: any) {
        teamSessions.setStatus(id, 'failed')
        bus?.emit(`team:${id}:event`, { type: 'team_failed', error: err.message })
        broadcaster?.emit({ runId: id, nodeId: id, parentId: null, seq: nextSeq(),
          payload: { type: 'run_completed', status: 'failed', totalTokens: 0, totalCostUsd: 0 } })
      }
    })()
```

- [ ] **Step 4: Wire the broadcaster in `index.ts`**

Find where `createTeamRoutes(...)` is called in `src/modules/agent/index.ts` and where the WS registry is available (grep `createTeamRoutes` and the http/ws registry accessor — likely `ctx.http` / a `wsRegistry`). Construct and pass:
```ts
import { createOrchestrationBroadcaster } from './orchestration-broadcaster.js'
// ...
const orchestrationBroadcaster = wsRegistry
  ? createOrchestrationBroadcaster(wsRegistry)
  : undefined
createTeamRoutes(teamApi, teamSessions, orchestrator, ctx.bus, orchestrationBroadcaster)
```
If the WS registry isn't reachable in this module today, grep how `mission-control` obtains it (`src/modules/mission-control/index.ts`) and mirror that wiring. If it is genuinely unavailable, leave `broadcaster` undefined (feature-flagged off) and note it — do NOT fabricate an accessor.

- [ ] **Step 5: Run the test + typecheck**

Run: `bun vitest run tests/modules/agent/team-routes-broadcast.test.ts && bun run typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit** — STOP, ask the user first.

```bash
git add src/modules/agent/routes-team.ts src/modules/agent/index.ts tests/
git commit -m "feat(agent): broadcast normalized orchestration events on team execute"
```

---

### Task 5: Per-subagent live progress (node_started/progress/completed with the real conversationId)

**Goal:** Emit fine-grained per-subagent events so the tree is live, and emit `node_started` with the REAL child `conversationId` (solving the provisional-node problem at the source) directly from `runAgentInConversation`.

**Files:**
- Modify: `src/modules/agent/orchestrator.ts` (`runAgentInConversation` gains an `onProgress` option; `executeTeam` passes it)
- Modify: `src/modules/agent/routes-team.ts` (build the `onProgress` sink that adapts to `OrchestrationEvent` and broadcasts)
- Test: `tests/modules/agent/agent-node-progress.test.ts`

**Interfaces:**
- `runAgentInConversation(agentId, parentConversationId, goalDescription, autoRouteModel, options?)` — `options` gains:
  `onProgress?: (e: { kind: 'node_started'; conversationId: string; agentId: string } | { kind: 'node_progress'; conversationId: string; turn: number; tokens: number } | { kind: 'tool'; conversationId: string; toolId: string; name?: string; status?: 'success' | 'error' }) => void`
- Consumes: `AgentEvent` (`agent-runner.ts:24`) — relevant variants: `turn_complete{turn,tokensUsed}`, `tool_result{toolUseId,content,isError,durationMs}`, `done`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/modules/agent/agent-node-progress.test.ts
import { describe, it, expect, vi } from 'vitest'
import { createOrchestrator } from '@modules/agent/orchestrator.js'

// Minimal fakes: agentRegistry with one agent, conversations that returns ids,
// an agentRunner whose run() yields a turn_complete then done.
function deps(events: any[]) {
  let created = 0
  return {
    bus: { emit: vi.fn() },
    agentRegistry: { get: () => ({ id: 'a1', name: 'A1', model: 'x', tools: [], systemPrompt: '', constraints: [], maxTurns: 5 }), addTokenUsage: vi.fn() },
    conversations: { create: () => ({ id: `conv${++created}` }), update: vi.fn(), addMessage: vi.fn() },
    toolRegistry: { toToolDefinitions: () => [] },
    modelRouter: { selectModel: () => ({ provider: 'anthropic', model: 'x' }) },
    agentRunner: { async *run() { for (const e of events) yield e } },
    rePlanner: { replan: vi.fn() },
    teamSessions: undefined,
  } as any
}

describe('runAgentInConversation onProgress', () => {
  it('emits node_started with the real conversationId, then node_progress per turn', async () => {
    const seen: any[] = []
    const orch = createOrchestrator(deps([
      { type: 'turn_complete', turn: 1, tokensUsed: 10 },
      { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: false, durationMs: 5 },
      { type: 'done', response: { content: [{ type: 'text', text: 'done' }] } },
    ]))
    await orch.runAgentInConversation('a1', 'p1', 'goal', false, {
      onProgress: (e: any) => seen.push(e),
    })
    expect(seen[0]).toMatchObject({ kind: 'node_started', agentId: 'a1' })
    expect(seen[0].conversationId).toMatch(/^conv/)
    expect(seen.some(e => e.kind === 'node_progress' && e.turn === 1 && e.tokens === 10)).toBe(true)
    expect(seen.some(e => e.kind === 'tool' && e.toolId === 't1' && e.status === 'success')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun vitest run tests/modules/agent/agent-node-progress.test.ts`
Expected: FAIL — `onProgress` never called.

- [ ] **Step 3: Emit progress inside `runAgentInConversation`**

Extend the `options` type on `runAgentInConversation` (line 559) and emit inside the loop:
```ts
options?: {
  useWorktree?: boolean; worktreeBasePath?: string; teamSessionId?: string
  onProgress?: (e:
    | { kind: 'node_started'; conversationId: string; agentId: string }
    | { kind: 'node_progress'; conversationId: string; turn: number; tokens: number }
    | { kind: 'tool'; conversationId: string; toolId: string; name?: string; status?: 'success' | 'error' }
  ) => void
},
```
Right after the child conversation exists (after the `conversations.update(childConv.id, {...})` block, ~line 575):
```ts
options?.onProgress?.({ kind: 'node_started', conversationId: childConv.id, agentId })
```
Inside the `for await (const event of agentRunner.run(...))` loop (line 625) add:
```ts
if (event.type === 'turn_complete') {
  tokensUsed += event.tokensUsed
  options?.onProgress?.({ kind: 'node_progress', conversationId: childConv.id, turn: event.turn, tokens: event.tokensUsed })
}
if (event.type === 'tool_result') {
  options?.onProgress?.({ kind: 'tool', conversationId: childConv.id, toolId: event.toolUseId, status: event.isError ? 'error' : 'success' })
}
```
(Keep the existing `done`/`turn_complete` token accounting; just add the `onProgress` calls.)

- [ ] **Step 4: Pass `onProgress` from `executeTeam`**

In `executeTeam`, thread an `onProgress` through both the parallel `runAgentInConversation(...)` call (line 446) and the sequential one (line 484). Add an `onProgress` parameter to `executeTeam`'s options is invasive; instead accept it via a closure: give `createOrchestrator` deps an optional `onNodeProgress?` OR pass it as a 5th `executeTeam` arg. Choose the 5th-arg form:
```ts
async *executeTeam(
  config: TeamConfig,
  parentConversationId: string,
  goalDescription: string,
  teamSessionId: string,
  onProgress?: RunAgentProgress,   // same union as above; export the type
): AsyncGenerator<OrchestratorEvent> {
```
and pass `{ ...worktreeOpts, teamSessionId, onProgress }` into both `runAgentInConversation` calls. Export the progress union as `RunAgentProgress` for reuse.

- [ ] **Step 5: Build the sink in `routes-team.ts` approve loop**

Before the `for await` in the approve loop, create the sink that adapts progress → `OrchestrationEvent` and broadcasts, then pass it as the 5th arg:
```ts
const onProgress = (e: RunAgentProgress) => {
  if (!broadcaster) return
  const nodeId = `conv:${e.conversationId}`
  if (e.kind === 'node_started')
    broadcaster.emit({ runId: id, nodeId, parentId: null, seq: nextSeq(),
      payload: { type: 'node_started', kind: 'subagent', label: e.agentId, agentId: e.agentId, conversationId: e.conversationId } })
  else if (e.kind === 'node_progress')
    broadcaster.emit({ runId: id, nodeId, parentId: null, seq: nextSeq(),
      payload: { type: 'node_progress', turn: e.turn, tokens: e.tokens } })
  else
    broadcaster.emit({ runId: id, nodeId, parentId: null, seq: nextSeq(),
      payload: e.status === 'error'
        ? { type: 'tool_result', toolId: e.toolId, status: 'error' }
        : { type: 'tool_result', toolId: e.toolId, status: 'success' } })
}
// ...
for await (const event of orchestrator.executeTeam(config, session.parentConversationId, goal, id, onProgress)) {
```
(`parentId: null` here is a P0 simplification — the child node currently attaches at run root; the frontend reducer can nest under the phase later. Keeping it null is correct and renders a flat-under-root tree until P0-frontend/P2 adds phase edges. Document this in the reducer plan.)

- [ ] **Step 6: Run the tests + full agent suite + typecheck**

Run: `bun vitest run tests/modules/agent/ && bun run typecheck`
Expected: PASS + clean.

- [ ] **Step 7: Commit** — STOP, ask the user first.

```bash
git add src/modules/agent/orchestrator.ts src/modules/agent/routes-team.ts tests/
git commit -m "feat(agent): per-subagent live progress events with real conversationId"
```

---

### Task 6: Full-suite green gate

- [ ] **Step 1: Run the offline suite**

Run: `bun vitest run`
Expected: green (e2e excluded by `vitest.config.ts`). If any pre-existing team/orchestrator test broke due to the `createTeamRoutes`/`executeTeam`/`create` signature changes, fix the call sites (all new params are optional except `goalDescription` on `create` — update every `teamSessions.create(...)` caller to pass it; grep `\.create(` on the team session service).

- [ ] **Step 2: Typecheck + lint**

Run: `bun run typecheck` and the repo's lint script if present.
Expected: clean.

- [ ] **Step 3: Manual WS smoke (optional but recommended)**

Start the server, open a conversation, POST a team propose+approve, and confirm frames arrive on `orchestration:<sessionId>` via the browser devtools WS panel (or a `wscat` against `/ws` after subscribing). This validates the transport end-to-end before P0-frontend renders it.

## Self-Review

- **Spec coverage:** §4.1 event model → Task 1. §4.5 transport (direct broadcast, not the dead bridge) → Task 2/4. §4.2 real `node_progress` + `parentId` + empty-goal fix → Tasks 3/5. Frontend §4.6 → separate P0-frontend plan (declared). ✓
- **Placeholder scan:** no TBD/TODO; each code step has real code. The only deferred detail is the `index.ts` WS-registry accessor (Task 4 Step 4) — explicitly instructed to grep the Mission Control wiring rather than fabricate. ✓
- **Type consistency:** `OrchestrationEvent`/`OrchestrationPayload` defined in Task 1 and consumed unchanged in Tasks 2/4/5; `RunAgentProgress` union defined in Task 5 Step 3 and reused in Steps 4-5; `goalDescription` added in Task 3 and consumed in Task 4. ✓
- **Known simplification:** child nodes use `parentId: null` in P0 (flat-under-root); phase nesting is a P0-frontend/P2 reducer concern — documented in Task 5 Step 5.
