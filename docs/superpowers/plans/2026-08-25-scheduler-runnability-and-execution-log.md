# Scheduler Runnability & Execution-Log Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a scheduled job that cannot execute visible — on its own row, with its cause named — and close the holes in the execution log where those failures currently vanish.

**Architecture:** Runnability is a pure function over (job row, handler map, armed-timer maps), evaluated on read and never stored, so a re-enabled module heals itself with no repair step. The execution log gains a `skip_reason` and an `actor`, and the one silent early exit in `executeJob` starts writing a row — deduplicated per process, because a persistent condition is a state, not 129,600 events. `next_run_at` is refreshed on every early exit so it stops drifting. Nothing in `src/core/` changes; the arming logic is untouched.

**Tech Stack:** Bun + TypeScript (strict, ESM), Drizzle over bun:sqlite, Hono, Zod, Vitest, React 19 + Tailwind, i18next.

**Spec:** `docs/superpowers/specs/2026-08-25-scheduler-runnability-and-execution-log-design.md`

## Global Constraints

- TypeScript strict, ESM. English code and comments.
- Pino for logging — never `console.log`.
- Zod for all external input validation.
- Every user-facing string ships in all six locales: `en`, `hu`, `de`, `es`, `fr`, `tlh`.
- CSS variables only — never hardcoded colours.
- `/api/v1/` prefix; every protected endpoint keeps its existing `requirePermission` guard.
- MIT-compatible dependencies only. **This plan adds no new dependency.**
- **Never change the version number** in `version.json`, `package.json`, or any HTML string.
- **Never commit, never branch, never push.** The author commits explicitly.
- File header on every new source file: `// Part of eYssen. See LICENSE file for full copyright and licensing details.`
- Lint is `bun run lint` (there is no `typecheck` script). Baseline is **52** `error TS` lines — do not increase it.
- 58 tests fail repo-wide for pre-existing reasons (`wip_limit`, `working_directories`, `docs-help`). They are **not** yours. Do not fix them, and do not count them as regressions.

---

## File Structure

**New:**

| File | Responsibility |
|---|---|
| `src/modules/scheduler/runnability.ts` | Pure fault evaluation. No DB, no service, no imports beyond types. |
| `src/modules/scheduler/tables.ts` | The single definition of the scheduler's tables (extracted from `index.ts`). |
| `src/web/src/pages/scheduler/runnability-view.ts` | Pure presentation logic: fault detection, infra-filter override, i18n key mapping. |
| `tests/modules/scheduler/runnability.test.ts` | Rule-table tests, no DB. |
| `tests/modules/scheduler/execution-log-skips.test.ts` | Skip rows, dedup, `next_run_at`, `actor`. |
| `tests/modules/scheduler/routes-runnability.test.ts` | API surface + trigger validation. |
| `tests/web/scheduler-runnability-view.test.ts` | Filter override and fault detection. |

**Modified:**

| File | Change |
|---|---|
| `src/modules/scheduler/types.ts` | `JobRunnability` re-export, `runnability?` on `ScheduledJob`, `includeRunnability?` on `ListJobsFilter`, `skipReason?`/`actor?` on `JobExecution` |
| `src/modules/scheduler/scheduler-service.ts` | `isArmed`, `getRunnability`, list enrichment, three early-exit paths, `actor` persistence, `health().unrunnable` |
| `src/modules/scheduler/index.ts` | Delegates DDL to `tables.ts` |
| `src/modules/scheduler/schema.ts` | Mirrors the two new columns |
| `src/modules/scheduler/routes.ts` | `runnability` in list/detail, trigger validation on POST/PATCH |
| `src/web/src/pages/scheduler/types.ts` | `JobRunnability` on the client `ScheduledJob`, `unrunnable` on health |
| `src/web/src/pages/scheduler/scheduler-page.tsx` | Fault badge, filter override, health chip |
| `src/web/src/pages/scheduler/locales/{en,hu,de,es,fr,tlh}.json` | New keys |
| `tests/modules/scheduler/{distributed-lock,routes,scheduler-hub,scheduler-service,runnability}.test.ts` | Use the shared table helper |

**Ordering:** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10 → T11 (docs last, so they describe what shipped). T3 must land before T4 (one DDL definition before adding columns to it). T4 must land before T5 (columns before writes). T2 must land before T6.

---

### Task 1: Runnability core

**Files:**
- Create: `src/modules/scheduler/runnability.ts`
- Modify: `src/modules/scheduler/types.ts`
- Test: `tests/modules/scheduler/runnability.test.ts`

**Interfaces:**
- Consumes: `ScheduledJob` from `./types.js`
- Produces: `evaluateRunnability(job: ScheduledJob, env: RunnabilityEnv): JobRunnability`, types `RunnabilityFault`, `JobRunnability`, `RunnabilityEnv`. Task 2 calls this; Task 8 mirrors the `JobRunnability` shape client-side.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/scheduler/runnability.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import { evaluateRunnability, type RunnabilityEnv } from '@modules/scheduler/runnability'
import type { ScheduledJob } from '@modules/scheduler/types'

function job(over: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: 'j1',
    name: 'Test job',
    triggerType: 'cron',
    triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
    handler: 'test.handler',
    status: 'active',
    runCount: 0,
    failCount: 0,
    consecutiveFails: 0,
    chainOnError: 'stop',
    source: 'system',
    kind: 'handler',
    timezone: 'UTC',
    maxConsecutiveFails: 5,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    ...over,
  } as ScheduledJob
}

const env = (over: Partial<RunnabilityEnv> = {}): RunnabilityEnv => ({
  hasHandler: () => true,
  isArmed: () => true,
  ...over,
})

describe('evaluateRunnability — no_handler', () => {
  it('faults when the handler is not registered', () => {
    const r = evaluateRunnability(job(), env({ hasHandler: () => false }))
    expect(r).toEqual({ runnable: false, fault: 'no_handler', detail: 'test.handler' })
  })

  // A definition-level fault: the job will no-op the moment it is resumed.
  it('faults on a paused job too', () => {
    const r = evaluateRunnability(job({ status: 'paused' }), env({ hasHandler: () => false }))
    expect(r.fault).toBe('no_handler')
  })

  it('takes precedence over unarmable_trigger', () => {
    const r = evaluateRunnability(
      job({ triggerType: 'event', triggerConfig: JSON.stringify({ event: 'x' }) }),
      env({ hasHandler: () => false }),
    )
    expect(r.fault).toBe('no_handler')
  })
})

describe('evaluateRunnability — unarmable_trigger', () => {
  it.each(['event', 'webhook'] as const)('faults on a %s trigger', (triggerType) => {
    const r = evaluateRunnability(job({ triggerType }), env())
    expect(r).toEqual({ runnable: false, fault: 'unarmable_trigger', detail: triggerType })
  })

  // manual is correctly unarmed — it runs via run(id), not a timer.
  it('does not fault a manual job that has a handler', () => {
    const r = evaluateRunnability(job({ triggerType: 'manual' }), env({ isArmed: () => false }))
    expect(r).toEqual({ runnable: true })
  })
})

describe('evaluateRunnability — not_armed', () => {
  it('faults an active cron job with no timer', () => {
    const r = evaluateRunnability(job(), env({ isArmed: () => false }))
    expect(r.fault).toBe('not_armed')
    expect(r.detail).toBe(JSON.stringify({ cron: '0 * * * *' }))
  })

  it('faults an active interval job with no timer', () => {
    const r = evaluateRunnability(
      job({ triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 10 }) }),
      env({ isArmed: () => false }),
    )
    expect(r.fault).toBe('not_armed')
  })

  // A paused or disabled job is *correctly* unarmed — that is intent, not breakage.
  it.each(['paused', 'disabled', 'dead_letter'] as const)('does not fault a %s job', (status) => {
    const r = evaluateRunnability(job({ status }), env({ isArmed: () => false }))
    expect(r).toEqual({ runnable: true })
  })
})

describe('evaluateRunnability — healthy', () => {
  it('reports a fully armed active cron job as runnable', () => {
    expect(evaluateRunnability(job(), env())).toEqual({ runnable: true })
  })

  // A follower node arms its timers and skips at fire time. Correct, not a fault.
  it('reports an armed job on a non-leader node as runnable', () => {
    expect(evaluateRunnability(job(), env({ isArmed: () => true }))).toEqual({ runnable: true })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun vitest run tests/modules/scheduler/runnability.test.ts`
Expected: FAIL — cannot resolve `@modules/scheduler/runnability`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/scheduler/runnability.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/scheduler/runnability.ts
// Pure evaluation of "would this job actually execute if its trigger fired?".
//
// Derived on read, NEVER stored. Writing this onto the job row would repeat the
// mistake the design spec §3.1 exists to prevent: `status` records what the user
// wants, and nearly every module seeds its job with
// `if (!existing.some(j => j.handler === X)) create(...)`. Marking a job
// disabled because its module is off would make the seeder skip re-creation on
// re-enable, and nothing would ever set it back — the job would be killed by
// the very mechanism meant to protect it. Computed on read, the fault simply
// disappears when the handler comes back.

// The domain types live in types.js alongside every other scheduler type, and
// this file imports them. Declaring them here instead would make types.ts point
// back at this module — a type-only cycle, harmless at runtime but pointless.
import type { ScheduledJob, JobRunnability } from './types.js'

/** The runtime facts the evaluation needs, injected so the rules stay pure. */
export interface RunnabilityEnv {
  hasHandler(name: string): boolean
  isArmed(jobId: string): boolean
}

/** Trigger types no code path arms. `manual` is deliberately absent: a manual
 *  job is correctly unarmed and runs via run(id). */
const UNARMABLE_TRIGGERS = new Set<string>(['event', 'webhook'])

/** Trigger types scheduleJob() can actually arm. */
const ARMABLE_TRIGGERS = new Set<string>(['cron', 'interval'])

/**
 * Faults are ordered most-fundamental first and the first match wins —
 * evidence before inference, as in classify-skill.ts.
 */
export function evaluateRunnability(job: ScheduledJob, env: RunnabilityEnv): JobRunnability {
  // 1. No handler. Definition-level, so it is reported for every status: a
  //    paused job with no handler no-ops the moment it is resumed or run by hand.
  if (!env.hasHandler(job.handler)) {
    return { runnable: false, fault: 'no_handler', detail: job.handler }
  }

  // 2. A trigger type nothing arms and nothing routes. Also definition-level.
  if (UNARMABLE_TRIGGERS.has(job.triggerType)) {
    return { runnable: false, fault: 'unarmable_trigger', detail: job.triggerType }
  }

  // 3. Armable, active, handler present — but no timer exists. That means
  //    scheduleJob() bailed: an invalid cron expression or a sub-second
  //    interval. Restricted to 'active' because a paused, disabled or
  //    dead-lettered job is *correctly* unarmed.
  if (job.status === 'active' && ARMABLE_TRIGGERS.has(job.triggerType) && !env.isArmed(job.id)) {
    return { runnable: false, fault: 'not_armed', detail: job.triggerConfig }
  }

  return { runnable: true }
}
```

- [ ] **Step 4: Extend `types.ts`**

Declare the domain types here, not in `runnability.ts` — every other scheduler
type lives in this file, and it keeps the import edge pointing one way.

In `src/modules/scheduler/types.ts`, add after the existing `JobStats24h` interface:

```ts
export type RunnabilityFault = 'no_handler' | 'unarmable_trigger' | 'not_armed'

export interface JobRunnability {
  runnable: boolean
  fault?: RunnabilityFault
  /** Actionable specifics: the missing handler name, the trigger type, the config. */
  detail?: string
}
```

Add to the `ScheduledJob` interface, directly below the existing `stats24h` field:

```ts
  /** Optional enrichment from list({ includeRunnability: true }). Derived, never persisted. */
  runnability?: JobRunnability
```

Add to `ListJobsFilter`:

```ts
  includeRunnability?: boolean
```

- [ ] **Step 5: Run the tests**

Run: `bun vitest run tests/modules/scheduler/runnability.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'`
Expected: `52` — unchanged from baseline.

---

### Task 2: Service accessors

**Files:**
- Modify: `src/modules/scheduler/scheduler-service.ts`
- Test: `tests/modules/scheduler/runnability.test.ts` (append a service-level block)

**Interfaces:**
- Consumes: `evaluateRunnability`, `RunnabilityEnv`, `JobRunnability` from Task 1.
- Produces: on the service object — `isArmed(jobId: string): boolean`, `getRunnability(job: ScheduledJob): JobRunnability`, and `list({ includeRunnability: true })` attaching `job.runnability`. Task 6 consumes all three.

- [ ] **Step 1: Write the failing test**

Append to `tests/modules/scheduler/runnability.test.ts`. Build the tables the same way the existing scheduler tests do — copy the `createSchedulerTables` and `createLocksTable` helpers verbatim from **`tests/modules/scheduler/distributed-lock.test.ts`**, which is the one file that defines both under those names. (The other three scheduler test files define a single `createTables` instead; do not use those.) Task 3 replaces all of them with a shared helper — do not pre-empt it here:

```ts
describe('scheduler service runnability', () => {
  it('reports no_handler for a job whose handler was never registered', () => {
    const db = createMemoryDb()
    createSchedulerTables(db)
    createLocksTable(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')

    const good = scheduler.create({
      name: 'Good', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${good.id}`)

    const job = scheduler.get(good.id)!
    expect(scheduler.getRunnability(job)).toEqual({
      runnable: false, fault: 'no_handler', detail: 'gone.handler',
    })
  })

  it('isArmed is true for an armed cron job and false for an unknown id', () => {
    const db = createMemoryDb()
    createSchedulerTables(db)
    createLocksTable(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Armed', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })
    expect(scheduler.isArmed(j.id)).toBe(true)
    expect(scheduler.isArmed('nope')).toBe(false)
  })

  it('list attaches runnability only when asked', () => {
    const db = createMemoryDb()
    createSchedulerTables(db)
    createLocksTable(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    scheduler.create({
      name: 'Listed', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'known.handler',
    })

    expect(scheduler.list()[0]!.runnability).toBeUndefined()
    expect(scheduler.list({ includeRunnability: true })[0]!.runnability).toEqual({ runnable: true })
  })

  // An invalid cron makes scheduleJob() bail — the job is created but no timer exists.
  it('reports not_armed for a job with an invalid cron expression', () => {
    const db = createMemoryDb()
    createSchedulerTables(db)
    createLocksTable(db)
    const scheduler = createSchedulerService(db, mockLogger)
    scheduler.registerHandler('known.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Broken', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: 'not a cron' }),
      handler: 'known.handler',
    })
    expect(scheduler.getRunnability(scheduler.get(j.id)!).fault).toBe('not_armed')
  })
})
```

Add the imports this block needs at the top of the file: `sql` from `drizzle-orm`, `createSchedulerService` from `@modules/scheduler/scheduler-service`, `createMemoryDb` from `../../helpers/test-db`, `vi` from `vitest`, and a `mockLogger` copied from `scheduler-service.test.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/scheduler/runnability.test.ts`
Expected: FAIL — `scheduler.getRunnability is not a function`.

- [ ] **Step 3: Implement**

In `src/modules/scheduler/scheduler-service.ts`, add to the imports:

```ts
import { evaluateRunnability, type RunnabilityEnv } from './runnability.js'
```

`JobRunnability` and `ScheduledJob` already come from the existing
`import type { ... } from './types.js'` block — extend that list rather than
adding a second import.

Inside `createSchedulerService`, directly after `let activeCount = 0`, add the environment. It closes over the live maps, so it needs no refresh:

```ts
  const runnabilityEnv: RunnabilityEnv = {
    hasHandler: (name) => handlers.has(name),
    isArmed: (id) => cronJobs.has(id) || intervalTimers.has(id),
  }
```

In the returned object, immediately after the existing `listHandlers()` method, add:

```ts
    isArmed(jobId: string): boolean {
      return runnabilityEnv.isArmed(jobId)
    },

    getRunnability(job: ScheduledJob): JobRunnability {
      return evaluateRunnability(job, runnabilityEnv)
    },
```

In `list()`, inside the final `rows.map(...)`, add one line after the `includeStats` line:

```ts
        if (f.includeRunnability) job.runnability = evaluateRunnability(job, runnabilityEnv)
```

- [ ] **Step 4: Run the tests**

Run: `bun vitest run tests/modules/scheduler/runnability.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Confirm no scheduler regression**

Run: `bun vitest run tests/modules/scheduler`
Expected: all existing scheduler tests still pass.

- [ ] **Step 6: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 3: One definition of the scheduler tables

**Purpose:** Four test files and `index.ts` each define `job_executions` by hand. Task 4 adds columns to it. Without this task those four fixtures drift out of sync and start failing on `no such column` — the exact failure mode that currently accounts for the repo's 58 broken tests. This task moves the DDL to one place and changes **no behaviour**.

**Files:**
- Create: `src/modules/scheduler/tables.ts`
- Modify: `src/modules/scheduler/index.ts`
- Modify: `tests/modules/scheduler/scheduler-service.test.ts`, `tests/modules/scheduler/routes.test.ts`, `tests/modules/scheduler/scheduler-hub.test.ts`, `tests/modules/scheduler/distributed-lock.test.ts`, `tests/modules/scheduler/runnability.test.ts`

**Interfaces:**
- Produces: `ensureSchedulerTables(db: any, logger?: { warn: (...a: any[]) => void }): void` — creates `scheduled_jobs`, `job_executions`, `scheduler_locks`, `job_admin_events`, runs the additive column migrations, and creates the indexes. Idempotent. Task 4 adds columns here.

- [ ] **Step 1: Record the green baseline**

Run: `bun vitest run tests/modules/scheduler 2>&1 | tail -5`
Write the pass count into your report. This task must end with the identical count.

- [ ] **Step 2: Create `src/modules/scheduler/tables.ts`**

Move — do not retype — the DDL currently in `schedulerModule.onRegister` (`src/modules/scheduler/index.ts`) and the whole `migrateJobColumns` function into a new file:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/modules/scheduler/tables.ts
// The single definition of the scheduler's tables. Production bootstrap and
// every test fixture call this, so a column added here cannot drift out of a
// fixture and fail later as "no such column".

import { sql } from 'drizzle-orm'

interface MinimalLogger {
  warn: (...args: any[]) => void
}

export function ensureSchedulerTables(db: any, logger?: MinimalLogger): void {
  // ... the four CREATE TABLE IF NOT EXISTS blocks, the tryAlter migrations,
  //     and the CREATE INDEX statements, moved verbatim from index.ts
}
```

Requirements:
- Keep every column, default, and index exactly as it is today. This step is a move, not a redesign.
- Keep the `tryAlter` helper's swallow-on-duplicate behaviour.
- `job_admin_events` creation keeps its `try/catch` with `logger?.warn(...)`; when no logger is passed the failure is swallowed as it is today in tests.
- Do **not** move `ensureRecurringTables` — it belongs to `board-recurring.ts`.

- [ ] **Step 3: Rewire `index.ts`**

In `src/modules/scheduler/index.ts`: delete the local `migrateJobColumns` function and the DDL block from `onRegister`, then import and call the helper. `onRegister` keeps its call to `ensureRecurringTables(ctx.db)`:

```ts
import { ensureSchedulerTables } from './tables.js'
// ...
    ensureSchedulerTables(ctx.db, ctx.logger)
    ensureRecurringTables(ctx.db)
```

- [ ] **Step 4: Rewire the five test fixtures**

In each of the five test files, replace the local table-building helper with a call to `ensureSchedulerTables(db)`. The helper is not named the same everywhere — check before you edit:

| File | Local helper(s) to replace |
|---|---|
| `distributed-lock.test.ts` | `createSchedulerTables` + `createLocksTable` |
| `routes.test.ts` | `createTables` |
| `scheduler-hub.test.ts` | `createTables` |
| `scheduler-service.test.ts` | `createTables` |
| `runnability.test.ts` | `createSchedulerTables` + `createLocksTable` (copied in by Task 2) |

Update every call site in the file, then delete the now-unused local definition.

`runnability.test.ts` is on the list because Task 2 copied those helpers into it.
Leaving that copy behind would create a fifth private definition of the same
tables — the very drift this task exists to remove. It would not have failed
loudly either, since those tests never insert into `job_executions`; it would
have sat there until the next column was added. Fix it here.

Replace **only** the DDL for `scheduled_jobs`, `job_executions`, `scheduler_locks` and `job_admin_events`. Leave every other table a test creates for itself exactly as it is. If a test asserts on a column the old fixture omitted, that assertion is still valid — the helper is a superset.

- [ ] **Step 5: Verify byte-for-byte behaviour**

Run: `bun vitest run tests/modules/scheduler 2>&1 | tail -5`
Expected: the **same** pass count as Step 1, zero failures. If any test now fails, the move was not faithful — diff the helper against the original DDL rather than adjusting the test.

- [ ] **Step 6: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 4: `skip_reason` and `actor` columns

**Files:**
- Modify: `src/modules/scheduler/tables.ts`, `src/modules/scheduler/schema.ts`, `src/modules/scheduler/types.ts`, `src/modules/scheduler/scheduler-service.ts`
- Test: `tests/modules/scheduler/execution-log-skips.test.ts` (create; column-presence tests only in this task)

**Interfaces:**
- Consumes: `ensureSchedulerTables` from Task 3.
- Produces: `job_executions.skip_reason TEXT` and `job_executions.actor TEXT`; `JobExecution` gains `skipReason?: string` and `actor?: string`; `toExecution()` maps both. Task 5 writes them.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/scheduler/execution-log-skips.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { ensureSchedulerTables } from '@modules/scheduler/tables'
import { createMemoryDb } from '../../helpers/test-db'
import type { Logger } from 'pino'

export const mockLogger = {
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as unknown as Logger

describe('job_executions schema', () => {
  it('has skip_reason and actor columns', () => {
    const db = createMemoryDb()
    ensureSchedulerTables(db)
    const cols = (db.all(sql`PRAGMA table_info(job_executions)`) as any[]).map(
      (r: any) => r.name ?? r[1],
    )
    expect(cols).toContain('skip_reason')
    expect(cols).toContain('actor')
  })

  // Existing installations get the columns through the additive ALTER path.
  it('adds the columns to a pre-existing table without them', () => {
    const db = createMemoryDb()
    db.run(sql`CREATE TABLE job_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL
    )`)
    ensureSchedulerTables(db)
    const cols = (db.all(sql`PRAGMA table_info(job_executions)`) as any[]).map(
      (r: any) => r.name ?? r[1],
    )
    expect(cols).toContain('skip_reason')
    expect(cols).toContain('actor')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/scheduler/execution-log-skips.test.ts`
Expected: FAIL — `skip_reason` is not in the column list.

- [ ] **Step 3: Add the columns**

In `src/modules/scheduler/tables.ts`, add to the `job_executions` `CREATE TABLE` body, after `scheduled_for TEXT`:

```sql
      skip_reason TEXT,
      actor TEXT
```

And add two `tryAlter` calls beside the existing `scheduled_for` one, so existing databases pick them up:

```ts
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN skip_reason TEXT`)
  tryAlter(sql`ALTER TABLE job_executions ADD COLUMN actor TEXT`)
```

- [ ] **Step 4: Mirror in `schema.ts`**

Nothing imports `src/modules/scheduler/schema.ts` today — the live DDL is raw SQL. Keeping it in step costs two lines and stops the drift widening; reviving or deleting the file is out of scope. Add to `jobExecutions`:

```ts
  skipReason: text('skip_reason'),
  actor: text('actor'),
```

- [ ] **Step 5: Surface them on the type**

In `src/modules/scheduler/types.ts`, add to `JobExecution`:

```ts
  /** Why a 'skipped' row exists: 'concurrency' | 'lock_held' | 'no_handler'. */
  skipReason?: string
  /** Who caused this run — a user id, 'agent', or 'system' for a timer. */
  actor?: string
```

In `src/modules/scheduler/scheduler-service.ts`, add to `toExecution()`:

```ts
    skipReason: raw.skip_reason ?? undefined,
    actor: raw.actor ?? undefined,
```

- [ ] **Step 6: Run the tests**

Run: `bun vitest run tests/modules/scheduler`
Expected: the new file passes; every pre-existing scheduler test still passes.

- [ ] **Step 7: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 5: Complete the execution log

**Files:**
- Modify: `src/modules/scheduler/scheduler-service.ts`
- Test: `tests/modules/scheduler/execution-log-skips.test.ts` (append)

**Interfaces:**
- Consumes: the columns from Task 4.
- Produces: a `skipped` row carrying `skip_reason` for all three early exits; `actor` persisted on every execution row; `next_run_at` refreshed on all three early exits. Task 6 reports the resulting counts through `health()`.

- [ ] **Step 1: Write the failing test**

Append to `tests/modules/scheduler/execution-log-skips.test.ts`:

```ts
import { createSchedulerService } from '@modules/scheduler/scheduler-service'

function svc(db: any) {
  ensureSchedulerTables(db)
  return createSchedulerService(db, mockLogger)
}

function execRows(db: any, jobId: string): any[] {
  return db.all(sql`SELECT * FROM job_executions WHERE job_id = ${jobId} ORDER BY id ASC`) as any[]
}

describe('missing handler is recorded', () => {
  it('writes exactly one skipped row with skip_reason=no_handler', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${j.id}`)

    await scheduler.run(j.id, 'tester')

    const rows = execRows(db, j.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('skipped')
    expect(rows[0].skip_reason).toBe('no_handler')
    expect(rows[0].actor).toBe('tester')
  })

  // A persistent condition is a state, not an event. A '* * * * *' job with a
  // disabled module would otherwise write ~129,600 rows per retention window.
  it('does not write a second row on a repeat fire', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler' WHERE id = ${j.id}`)

    await scheduler.run(j.id)
    await scheduler.run(j.id)
    await scheduler.run(j.id)

    expect(execRows(db, j.id)).toHaveLength(1)
  })

  // update() can repoint a job at another handler. A user fixing a broken job by
  // typing a second wrong name must still get a row, or the log goes quiet
  // exactly when they are trying to work out what is wrong.
  it('logs again when the job is repointed at a different missing handler', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.one' WHERE id = ${j.id}`)
    await scheduler.run(j.id)
    await scheduler.run(j.id)
    expect(execRows(db, j.id)).toHaveLength(1)

    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.two' WHERE id = ${j.id}`)
    await scheduler.run(j.id)

    const rows = execRows(db, j.id)
    expect(rows).toHaveLength(2)
    expect(rows[1].error).toContain('gone.two')
  })

  it('advances next_run_at on every fire, including the deduped ones', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Orphan', triggerType: 'interval', triggerConfig: JSON.stringify({ intervalMs: 60_000 }),
      handler: 'real.handler',
    })
    db.run(sql`UPDATE scheduled_jobs SET handler = 'gone.handler', next_run_at = '2000-01-01T00:00:00.000Z' WHERE id = ${j.id}`)

    await scheduler.run(j.id)
    const first = scheduler.get(j.id)!.nextRunAt!
    expect(Date.parse(first)).toBeGreaterThan(Date.parse('2020-01-01T00:00:00.000Z'))

    await scheduler.run(j.id)
    const second = scheduler.get(j.id)!.nextRunAt!
    expect(Date.parse(second)).toBeGreaterThanOrEqual(Date.parse(first))
  })
})

describe('actor on normal executions', () => {
  it('records the caller on a successful run and defaults to system', async () => {
    const db = createMemoryDb()
    const scheduler = svc(db)
    scheduler.registerHandler('real.handler', async () => 'ok')
    const j = scheduler.create({
      name: 'Fine', triggerType: 'cron', triggerConfig: JSON.stringify({ cron: '0 * * * *' }),
      handler: 'real.handler',
    })

    await scheduler.run(j.id, 'alice')
    expect(execRows(db, j.id)[0].actor).toBe('alice')

    await scheduler.run(j.id)
    expect(execRows(db, j.id)[1].actor).toBe('system')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/scheduler/execution-log-skips.test.ts`
Expected: FAIL — the missing-handler run writes no row at all.

- [ ] **Step 3: Add the dedup set**

In `createSchedulerService`, beside `const runningIds = new Set<string>()`:

```ts
  /** `${jobId}:${handlerName}` pairs that have already logged a no_handler skip
   *  in THIS process. Transitions are events; a standing condition is a state
   *  (spec §3.3) — a '* * * * *' job whose module is disabled would otherwise
   *  write ~129,600 rows inside the 90-day retention window.
   *
   *  Keyed by job AND handler name, not job alone: `update()` can repoint a job
   *  at a different handler, so a user who fixes a broken job by typing a second
   *  wrong name would otherwise get no new row at all. The handler map itself
   *  can only change at process start, which is why a per-process Set is exact
   *  for everything else.
   *
   *  Note the asymmetry below: 'concurrency' and 'lock_held' are NOT deduped —
   *  those are transient, and each occurrence is genuinely informative. */
  const loggedNoHandler = new Set<string>()
```

- [ ] **Step 4: Rewrite the missing-handler early exit**

Replace the current body of the `if (!handler)` block in `executeJob`:

```ts
    const handler = handlers.get(job.handler)
    if (!handler) {
      logger.warn(`No handler registered for job ${job.id}: ${job.handler}`)
      const noHandlerKey = `${job.id}:${job.handler}`
      if (!loggedNoHandler.has(noHandlerKey)) {
        loggedNoHandler.add(noHandlerKey)
        const at = new Date().toISOString()
        db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, skip_reason, actor, scheduled_for)
          VALUES (${job.id}, 'skipped', ${at}, ${at}, 0, ${`no handler registered: ${job.handler}`}, ${'no_handler'}, ${opts?.actor ?? 'system'}, ${opts?.scheduledFor ?? null})`)
        emit?.('scheduler.job.skipped', { jobId: job.id, reason: 'no_handler', handler: job.handler })
      }
      // Outside the dedup on purpose: next_run_at answers "when is the next run
      // declared for", and that stays true even for a job that cannot run.
      refreshNextRun(job)
      return
    }
```

- [ ] **Step 5: Complete the other two early exits**

In the concurrency-limit block, add `skip_reason`/`actor` to the INSERT and refresh the next run:

```ts
      db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, skip_reason, actor, scheduled_for)
        VALUES (${job.id}, 'skipped', ${startedAt}, ${startedAt}, 0, ${'concurrency limit'}, ${'concurrency'}, ${opts?.actor ?? 'system'}, ${opts?.scheduledFor ?? null})`)
      emit?.('scheduler.job.skipped', { jobId: job.id, reason: 'concurrency' })
      refreshNextRun(job)
      return
```

And in the lock-held block:

```ts
      db.run(sql`INSERT INTO job_executions (job_id, status, started_at, completed_at, duration_ms, error, skip_reason, actor, scheduled_for)
        VALUES (${job.id}, 'skipped', ${startedAt}, ${startedAt}, 0, ${'lock held by another holder'}, ${'lock_held'}, ${opts?.actor ?? 'system'}, ${opts?.scheduledFor ?? null})`)
      refreshNextRun(job)
      return
```

- [ ] **Step 6: Persist `actor` on real executions**

Add `actor` to the `'running'` INSERT:

```ts
    db.run(sql`INSERT INTO job_executions (job_id, status, started_at, actor, scheduled_for)
      VALUES (${job.id}, 'running', ${startedAt}, ${opts?.actor ?? 'system'}, ${opts?.scheduledFor ?? null})`)
```

Add `actor` to the two fallback INSERTs in the success and failure branches (the `else` arms taken when `execId` is undefined), placing `${opts?.actor ?? 'system'}` in a matching `actor` column. Leave the `UPDATE` statements alone — the row already carries its actor.

Do **not** touch the non-leader skip at `scheduler-service.ts:299-302`. On a three-node cluster it would triple the log to record the two nodes that correctly did nothing.

- [ ] **Step 7: Run the tests**

Run: `bun vitest run tests/modules/scheduler`
Expected: the new tests pass; every pre-existing scheduler test still passes.

- [ ] **Step 8: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 6: Runnability on the API

**Files:**
- Modify: `src/modules/scheduler/routes.ts`, `src/modules/scheduler/scheduler-service.ts`
- Test: `tests/modules/scheduler/routes-runnability.test.ts` (create)

**Interfaces:**
- Consumes: `list({ includeRunnability: true })` and `getRunnability(job)` from Task 2.
- Produces: `runnability` on every job in `GET /scheduler/jobs` and `GET /scheduler/jobs/:id`; `unrunnable: number` on `GET /scheduler/health`. Task 9 renders both.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/scheduler/routes-runnability.test.ts`. Mirror the app/auth setup used by the existing `tests/modules/scheduler/routes.test.ts` — read that file first and copy its harness rather than inventing one.

Build this fixture in a `beforeEach`, so `brokenId` and `goodId` below are real
values and not hand-waving: register one handler named `real.handler`, create a
job `Fine` using it, create a job `Orphan` using it, then
`UPDATE scheduled_jobs SET handler = 'gone.handler'` for `Orphan` only. That
leaves exactly one faulted job and one healthy one. Keep `brokenId` and `goodId`
in scope for the later assertions.

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

// Harness (app construction, permission stubbing) copied from routes.test.ts.
// Fixture per the paragraph above: `Fine` is healthy, `Orphan` has a handler
// name that was never registered.

describe('GET /scheduler/jobs — runnability', () => {
  it('includes runnability on every job', async () => {
    const res = await app.request('/api/v1/scheduler/jobs')
    const body = await res.json()
    const broken = body.jobs.find((j: any) => j.name === 'Orphan')
    expect(broken.runnability).toEqual({
      runnable: false, fault: 'no_handler', detail: 'gone.handler',
    })
    const healthy = body.jobs.find((j: any) => j.name === 'Fine')
    expect(healthy.runnability).toEqual({ runnable: true })
  })
})

describe('GET /scheduler/jobs/:id — runnability', () => {
  it('includes runnability on the detail response', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${brokenId}`)
    expect((await res.json()).job.runnability.fault).toBe('no_handler')
  })
})

describe('GET /scheduler/health — unrunnable', () => {
  it('counts jobs that cannot run', async () => {
    const res = await app.request('/api/v1/scheduler/health')
    expect((await res.json()).unrunnable).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/scheduler/routes-runnability.test.ts`
Expected: FAIL — `runnability` is undefined.

- [ ] **Step 3: List route**

In `src/modules/scheduler/routes.ts`, in the `GET /scheduler/jobs` handler, add `includeRunnability: true` to the filter object it builds. `enrichJob` spreads `...job`, so the field flows through with no change to `enrichJob` itself.

- [ ] **Step 4: Detail route**

`scheduler.get(id)` does not enrich. The handler already returns three keys — `job`, `executions` and `adminHistory` — and already passes `stats24h` into `enrichJob`. Attach runnability the same way, alongside `stats24h`. **Do not collapse the response to `{ job }`**: dropping `executions` and `adminHistory` would break the UI's run-history panel.

```ts
    return c.json({
      job: enrichJob({ ...job, stats24h, runnability: scheduler.getRunnability(job) }),
      executions,
      adminHistory,
    })
```

- [ ] **Step 5: Health count**

In `scheduler-service.ts`, in `health()`, declare `let unrunnable = 0` beside the other counters, add inside the existing `for (const j of jobs)` loop:

```ts
        if (!evaluateRunnability(j, runnabilityEnv).runnable) unrunnable++
```

and add `unrunnable` to the returned object and to the return type annotation.

- [ ] **Step 6: Run the tests**

Run: `bun vitest run tests/modules/scheduler`
Expected: all pass.

- [ ] **Step 7: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 7: Reject unschedulable triggers

**Files:**
- Modify: `src/modules/scheduler/routes.ts`
- Test: `tests/modules/scheduler/routes-runnability.test.ts` (append)

**Interfaces:**
- Consumes: `computeNextRunAt` from `./cron-utils.js`; `scheduler.get(id)`.
- Produces: `POST /scheduler/jobs` and `PATCH /scheduler/jobs/:id` return **400** for a `cron` or `interval` trigger that yields no next run.

- [ ] **Step 1: Write the failing test**

Append to `tests/modules/scheduler/routes-runnability.test.ts`:

```ts
describe('trigger validation', () => {
  it('rejects an invalid cron expression with 400', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Typo', cronExpression: 'not a cron', handler: 'real.handler' }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a sub-second interval with 400', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'TooFast', intervalMs: 10, handler: 'real.handler' }),
    })
    expect(res.status).toBe(400)
  })

  it('still accepts a valid cron expression', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Good', cronExpression: '0 9 * * *', handler: 'real.handler' }),
    })
    expect(res.status).toBe(201)
  })

  // Deliberate asymmetry, spec §7.3: an invalid cron is a mistake, choosing
  // 'event' is a feature request the UI actively offers. It is created and
  // plainly marked instead of being silently refused.
  it('still accepts an event trigger and marks it unrunnable', async () => {
    const res = await app.request('/api/v1/scheduler/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Evt', eventName: 'conversation.completed', handler: 'real.handler' }),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).job.runnability?.fault ?? 'unarmable_trigger').toBe('unarmable_trigger')
  })

  it('rejects a PATCH that would make the effective trigger unschedulable', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cronExpression: 'still not a cron' }),
    })
    expect(res.status).toBe(400)
  })
})
```

Note for the `event` case: `POST` currently returns `enrichJob(job)` without runnability. Either add it there too, or assert only on the 201. Prefer adding it — the create response should tell the truth about what was just created.

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/scheduler/routes-runnability.test.ts`
Expected: FAIL — the invalid-cron POST returns 201.

- [ ] **Step 3: Add the guard helper**

In `src/modules/scheduler/routes.ts`, extend the existing `cron-utils.js` import with `computeNextRunAt`, and add beside `normalizeTrigger`:

```ts
/** A cron or interval trigger that yields no next run can never fire. Rejecting
 *  it here is the only moment the user can still fix the typo — after creation
 *  the job just sits there looking healthy. Non-time triggers pass through:
 *  they legitimately have no next run. */
function triggerIsSchedulable(triggerType: string, triggerConfig: string): boolean {
  if (triggerType !== 'cron' && triggerType !== 'interval') return true
  return computeNextRunAt(triggerType, triggerConfig) !== null
}
```

- [ ] **Step 4: Guard POST**

In the `POST /scheduler/jobs` handler, directly after the `if (!norm)` check:

```ts
    if (!triggerIsSchedulable(norm.triggerType, norm.triggerConfig)) {
      return c.json({ error: `Unschedulable ${norm.triggerType} trigger: ${norm.triggerConfig}` }, 400)
    }
```

Also attach runnability to the created job in the same handler:

```ts
    return c.json({ job: { ...enrichJob(job), runnability: scheduler.getRunnability(job) } }, 201)
```

- [ ] **Step 5: Guard PATCH**

In the `PATCH /scheduler/jobs/:id` handler, after the `handler` check and before calling `scheduler.update`, validate the **effective** trigger. A partial patch can change `triggerType` alone and leave the old config in place, so the patch body on its own is not enough:

```ts
    const existingJob = scheduler.get(c.req.param('id'))
    if (!existingJob) return c.json({ error: 'Job not found' }, 404)
    const effectiveType = data.triggerType ?? existingJob.triggerType
    const effectiveConfig = data.triggerConfig ?? existingJob.triggerConfig
    if (!triggerIsSchedulable(effectiveType, effectiveConfig)) {
      return c.json({ error: `Unschedulable ${effectiveType} trigger: ${effectiveConfig}` }, 400)
    }
```

This moves the 404 ahead of the update call. The later `if (!job) return 404` becomes unreachable — leave it as a defensive guard rather than deleting it.

- [ ] **Step 6: Stop `POST /scheduler/jobs/:id/run` reporting a run that did not happen**

The run route (`routes.ts:223`) unconditionally returns `{ message: 'Job executed' }` with 200. But `executeJob` has early exits that do nothing: a `disabled` or `dead_letter` job returns immediately, and a job with no handler writes a skip row and returns. In both cases the caller is told the job executed. **That is a false success — strictly worse than the silence this whole feature exists to remove**, and it sits in the same endpoint family.

Refuse up front instead, so the answer is immediate and specific:

```ts
  api.post('/scheduler/jobs/:id/run', requirePermission('update', 'Scheduler'), async (c) => {
    const job = scheduler.get(c.req.param('id'))
    if (!job) return c.json({ error: 'Job not found' }, 404)

    // Do not claim a run that executeJob would silently decline.
    if (job.status === 'disabled' || job.status === 'dead_letter') {
      return c.json({ error: `Job is ${job.status} — resume it before running.`, status: job.status }, 409)
    }
    const runnability = scheduler.getRunnability(job)
    if (!runnability.runnable) {
      return c.json({ error: `Job cannot run: ${runnability.fault} (${runnability.detail})`, runnability }, 409)
    }

    try {
      const userId = (c as any).get?.('userId') as string | undefined
      await scheduler.run(job.id, userId)
      return c.json({ message: 'Job executed' })
    } catch (err: any) {
      return c.json({ error: err.message }, 404)
    }
  })
```

Note the deliberate trade: refusing before `scheduler.run` means a manual attempt on a broken job no longer writes a `no_handler` skip row. That is the right call for a *manual* run — the user gets an immediate, specific answer instead of a row in a log they would have to go find. Scheduled fires still write the row, which is what §5.2 is for.

Add tests to `routes-runnability.test.ts`:

```ts
describe('POST /scheduler/jobs/:id/run — truthful response', () => {
  it('returns 409 rather than a false success for a job with no handler', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${brokenId}/run`, { method: 'POST' })
    expect(res.status).toBe(409)
    expect((await res.json()).runnability.fault).toBe('no_handler')
  })

  it('returns 409 for a disabled job', async () => {
    await app.request(`/api/v1/scheduler/jobs/${goodId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'disabled' }),
    })
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}/run`, { method: 'POST' })
    expect(res.status).toBe(409)
  })

  // `goodId` is the healthy 'Fine' job from the Task 6 fixture. Each test gets a
  // fresh DB via beforeEach, so the disabled-job test above does not leak here.
  it('still runs a healthy job', async () => {
    const res = await app.request(`/api/v1/scheduler/jobs/${goodId}/run`, { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 7: Run the tests**

Run: `bun vitest run tests/modules/scheduler`
Expected: all pass, including the pre-existing `routes.test.ts`.

- [ ] **Step 8: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 8: Web presentation logic

**Files:**
- Create: `src/web/src/pages/scheduler/runnability-view.ts`
- Modify: `src/web/src/pages/scheduler/types.ts`
- Test: `tests/web/scheduler-runnability-view.test.ts` (create)

**Interfaces:**
- Produces: `isFaulted(job)`, `applyInfraFilter(jobs, showInfra, sourceFilter)`, `faultLabelKey(fault)`, `faultTooltipKey(fault)`, and the client-side `JobRunnability` / `RunnabilityFault` types. Task 9 consumes all of them.

- [ ] **Step 1: Write the failing test**

Create `tests/web/scheduler-runnability-view.test.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.

import { describe, it, expect } from 'vitest'
import {
  isFaulted,
  applyInfraFilter,
  faultLabelKey,
  faultTooltipKey,
} from '../../src/web/src/pages/scheduler/runnability-view'

const healthySystem = { id: 'a', source: 'system', kind: 'handler', runnability: { runnable: true } }
const brokenSystem = {
  id: 'b', source: 'system', kind: 'handler',
  runnability: { runnable: false, fault: 'no_handler' as const, detail: 'gone.handler' },
}
const userJob = { id: 'c', source: 'user', kind: 'handler', runnability: { runnable: true } }
const agentRun = { id: 'd', source: 'system', kind: 'agent_run', runnability: { runnable: true } }

describe('isFaulted', () => {
  it('is false when runnability is absent', () => {
    expect(isFaulted({})).toBe(false)
  })
  it('is false for a runnable job and true for a faulted one', () => {
    expect(isFaulted(healthySystem)).toBe(false)
    expect(isFaulted(brokenSystem)).toBe(true)
  })
})

describe('applyInfraFilter', () => {
  const all = [healthySystem, brokenSystem, userJob, agentRun]

  // The rule the whole feature rests on: without it, the jobs most likely to
  // break — the module-seeded ones — stay invisible.
  it('never hides a faulted system job', () => {
    expect(applyInfraFilter(all, false, '').map((j) => j.id)).toEqual(['b', 'c', 'd'])
  })

  it('hides a healthy system job when infra is off', () => {
    expect(applyInfraFilter(all, false, '').some((j) => j.id === 'a')).toBe(false)
  })

  it('shows everything when infra is on', () => {
    expect(applyInfraFilter(all, true, '')).toHaveLength(4)
  })

  it('shows everything when the user explicitly filters to system', () => {
    expect(applyInfraFilter(all, false, 'system')).toHaveLength(4)
  })
})

describe('i18n key mapping', () => {
  it('maps each fault to its label and tooltip key', () => {
    expect(faultLabelKey('no_handler')).toBe('scheduler.fault.no_handler')
    expect(faultTooltipKey('not_armed')).toBe('scheduler.fault.not_armed.tooltip')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/web/scheduler-runnability-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/web/src/pages/scheduler/runnability-view.ts`:

```ts
// Part of eYssen. See LICENSE file for full copyright and licensing details.
// src/web/src/pages/scheduler/runnability-view.ts
// Pure presentation logic for job runnability — kept out of the .tsx so it is
// unit-testable without a DOM.

export type RunnabilityFault = 'no_handler' | 'unarmable_trigger' | 'not_armed'

export interface JobRunnability {
  runnable: boolean
  fault?: RunnabilityFault
  detail?: string
}

interface FilterableJob {
  source?: string
  kind?: string
  runnability?: JobRunnability
}

export function isFaulted(job: FilterableJob): boolean {
  return job.runnability != null && job.runnability.runnable === false
}

/**
 * The infra filter, with the one override the feature depends on: a job that
 * cannot run is NEVER hidden. Without it the badge would be invisible for
 * exactly the jobs most likely to break — the module-seeded `source: 'system'`
 * ones — and the feature would fail at its main use case.
 */
export function applyInfraFilter<T extends FilterableJob>(
  jobs: T[],
  showInfra: boolean,
  sourceFilter: string,
): T[] {
  if (showInfra || sourceFilter === 'system') return jobs
  return jobs.filter((j) => j.source !== 'system' || j.kind === 'agent_run' || isFaulted(j))
}

export function faultLabelKey(fault: RunnabilityFault): string {
  return `scheduler.fault.${fault}`
}

export function faultTooltipKey(fault: RunnabilityFault): string {
  return `scheduler.fault.${fault}.tooltip`
}
```

- [ ] **Step 4: Extend the client types**

In `src/web/src/pages/scheduler/types.ts`, add to `ScheduledJob` (below `stats24h`):

```ts
  runnability?: import('./runnability-view').JobRunnability
```

and add `unrunnable?: number` to the `SchedulerHealth` interface.

- [ ] **Step 5: Run the tests**

Run: `bun vitest run tests/web/scheduler-runnability-view.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 9: Page integration and six locales

**Files:**
- Modify: `src/web/src/pages/scheduler/scheduler-page.tsx`
- Modify: `src/web/src/pages/scheduler/locales/{en,hu,de,es,fr,tlh}.json`

**Interfaces:**
- Consumes: everything from Task 8, plus `runnability` and `health.unrunnable` from Tasks 6-7.

- [ ] **Step 1: Add the locale keys**

Add these keys to `en.json`:

```json
  "scheduler.fault.no_handler": "No handler",
  "scheduler.fault.no_handler.tooltip": "The handler \"{{detail}}\" is not registered — its module is most likely disabled. This job will not run.",
  "scheduler.fault.unarmable_trigger": "Never fires",
  "scheduler.fault.unarmable_trigger.tooltip": "\"{{detail}}\" triggers are not implemented yet, so this job will never start on its own. Use Run Now, or switch it to a cron or interval schedule.",
  "scheduler.fault.not_armed": "Not scheduled",
  "scheduler.fault.not_armed.tooltip": "This schedule could not be armed: {{detail}}. Check the cron expression or the interval.",
  "scheduler.health.unrunnable": "{{count}} cannot run",
  "scheduler.error.unschedulable": "That schedule is not valid, so the job would never run. Check the cron expression or the interval.",
  "scheduler.error.cannotRun": "This job cannot run right now — see the badge on its row for the reason."
```

`hu.json`:

```json
  "scheduler.fault.no_handler": "Nincs handler",
  "scheduler.fault.no_handler.tooltip": "A(z) „{{detail}}” handler nincs regisztrálva — a modulja valószínűleg ki van kapcsolva. Ez a feladat nem fog lefutni.",
  "scheduler.fault.unarmable_trigger": "Soha nem indul",
  "scheduler.fault.unarmable_trigger.tooltip": "A(z) „{{detail}}” trigger még nincs megvalósítva, így ez a feladat magától soha nem indul el. Használd a Futtatás most gombot, vagy állítsd át cron vagy intervallum ütemezésre.",
  "scheduler.fault.not_armed": "Nincs ütemezve",
  "scheduler.fault.not_armed.tooltip": "Ezt az ütemezést nem sikerült beállítani: {{detail}}. Ellenőrizd a cron kifejezést vagy az intervallumot.",
  "scheduler.health.unrunnable": "{{count}} nem tud futni",
  "scheduler.error.unschedulable": "Ez az ütemezés érvénytelen, így a feladat soha nem futna le. Ellenőrizd a cron kifejezést vagy az intervallumot.",
  "scheduler.error.cannotRun": "Ez a feladat most nem tud lefutni — az okát a sorában lévő jelzés mutatja."
```

`de.json`:

```json
  "scheduler.fault.no_handler": "Kein Handler",
  "scheduler.fault.no_handler.tooltip": "Der Handler „{{detail}}“ ist nicht registriert — sein Modul ist vermutlich deaktiviert. Dieser Job wird nicht ausgeführt.",
  "scheduler.fault.unarmable_trigger": "Startet nie",
  "scheduler.fault.unarmable_trigger.tooltip": "„{{detail}}“-Trigger sind noch nicht implementiert, dieser Job startet also nie von selbst. Nutze „Jetzt ausführen“ oder stelle auf Cron bzw. Intervall um.",
  "scheduler.fault.not_armed": "Nicht eingeplant",
  "scheduler.fault.not_armed.tooltip": "Dieser Zeitplan konnte nicht aktiviert werden: {{detail}}. Prüfe den Cron-Ausdruck oder das Intervall.",
  "scheduler.health.unrunnable": "{{count}} nicht lauffähig",
  "scheduler.error.unschedulable": "Dieser Zeitplan ist ungültig, der Job würde nie laufen. Prüfe den Cron-Ausdruck oder das Intervall.",
  "scheduler.error.cannotRun": "Dieser Job kann derzeit nicht laufen — der Grund steht im Hinweis in seiner Zeile."
```

`es.json`:

```json
  "scheduler.fault.no_handler": "Sin handler",
  "scheduler.fault.no_handler.tooltip": "El handler «{{detail}}» no está registrado — probablemente su módulo esté desactivado. Esta tarea no se ejecutará.",
  "scheduler.fault.unarmable_trigger": "Nunca se dispara",
  "scheduler.fault.unarmable_trigger.tooltip": "Los disparadores «{{detail}}» aún no están implementados, así que esta tarea nunca se iniciará sola. Usa Ejecutar ahora o cámbiala a cron o intervalo.",
  "scheduler.fault.not_armed": "Sin programar",
  "scheduler.fault.not_armed.tooltip": "No se pudo activar esta programación: {{detail}}. Revisa la expresión cron o el intervalo.",
  "scheduler.health.unrunnable": "{{count}} no pueden ejecutarse",
  "scheduler.error.unschedulable": "Esa programación no es válida, la tarea nunca se ejecutaría. Revisa la expresión cron o el intervalo.",
  "scheduler.error.cannotRun": "Esta tarea no puede ejecutarse ahora — el motivo aparece en la etiqueta de su fila."
```

`fr.json`:

```json
  "scheduler.fault.no_handler": "Aucun handler",
  "scheduler.fault.no_handler.tooltip": "Le handler « {{detail}} » n'est pas enregistré — son module est probablement désactivé. Cette tâche ne s'exécutera pas.",
  "scheduler.fault.unarmable_trigger": "Ne se déclenche jamais",
  "scheduler.fault.unarmable_trigger.tooltip": "Les déclencheurs « {{detail}} » ne sont pas encore implémentés : cette tâche ne démarrera jamais d'elle-même. Utilise Exécuter maintenant, ou passe à une planification cron ou par intervalle.",
  "scheduler.fault.not_armed": "Non planifiée",
  "scheduler.fault.not_armed.tooltip": "Cette planification n'a pas pu être activée : {{detail}}. Vérifie l'expression cron ou l'intervalle.",
  "scheduler.health.unrunnable": "{{count}} ne peuvent pas s'exécuter",
  "scheduler.error.unschedulable": "Cette planification est invalide, la tâche ne s'exécuterait jamais. Vérifie l'expression cron ou l'intervalle.",
  "scheduler.error.cannotRun": "Cette tâche ne peut pas s'exécuter pour le moment — la raison figure sur l'étiquette de sa ligne."
```

`tlh.json` — match the terse register the file already uses (`{{count}} Hegh QIn`, `{{count}} poH tlhoS`):

```json
  "scheduler.fault.no_handler": "Qu'wI' ngil pagh",
  "scheduler.fault.no_handler.tooltip": "Qu'wI' „{{detail}}“ tu'lu'be'. chuq HaSta chu'be'lu'. vumbe' Qu'vam.",
  "scheduler.fault.unarmable_trigger": "not chu'",
  "scheduler.fault.unarmable_trigger.tooltip": "„{{detail}}“ chu'wI' Segh chenbe'ta'. not mob 'ej vum Qu'vam. „DaH yIvum“ yIlo', pagh cron ghap poH vegh yIwIv.",
  "scheduler.fault.not_armed": "poHbe'lu'",
  "scheduler.fault.not_armed.tooltip": "poH Qu' chu'laHbe': {{detail}}. cron mu'tlhegh ghap poH vegh yIlegh.",
  "scheduler.health.unrunnable": "{{count}} vumlaHbe'",
  "scheduler.error.unschedulable": "poH Qu'vam lughbe'. not vum Qu'. cron mu'tlhegh ghap poH vegh yIlegh.",
  "scheduler.error.cannotRun": "DaH vumlaHbe' Qu'vam — meq 'oH per Daq."
```

- [ ] **Step 2: Verify all six files parse and hold the same keys**

Run:

```bash
cd src/web/src/pages/scheduler/locales && for f in en hu de es fr tlh; do
  printf '%s: %s keys, new=%s\n' "$f" "$(python3 -c "import json;print(len(json.load(open('$f.json'))))")" \
    "$(python3 -c "import json;d=json.load(open('$f.json'));print(sum(1 for k in d if k.startswith('scheduler.fault.') or k in ('scheduler.health.unrunnable','scheduler.error.unschedulable','scheduler.error.cannotRun')))")"
done
```

Expected: every file reports **69 keys → 78 keys, new=9**, and no JSON parse error.

All six files currently hold exactly 69 keys and are in sync — verified before this task started. The total matters as much as the `new` count: if a file reports 77 or 79, you have dropped or duplicated an existing key while editing, which the `new=9` check alone would not catch.

- [ ] **Step 3: Use the shared filter**

In `scheduler-page.tsx`, import from `./runnability-view`, then replace the `jobs` `useMemo` body with the shared helper:

```tsx
  const jobs = useMemo(
    () => applyInfraFilter(data?.jobs ?? [], showInfra, sourceFilter),
    [data?.jobs, showInfra, sourceFilter],
  )
```

- [ ] **Step 4: Add the per-row fault badge**

Beside the existing source `<Badge>` in the job row, render the fault when present. Use CSS variables or existing Tailwind semantic classes — never a hardcoded colour:

```tsx
{job.runnability?.fault && (
  <Badge
    variant="outline"
    className="text-[9px] border-amber-500/50 text-amber-400"
    title={t(faultTooltipKey(job.runnability.fault), { detail: job.runnability.detail })}
  >
    {t(faultLabelKey(job.runnability.fault))}
  </Badge>
)}
```

- [ ] **Step 5: Add the health chip**

Beside the existing `health.overdue` chip:

```tsx
{(health?.unrunnable ?? 0) > 0 && (
  <span className="text-amber-400">
    {t('scheduler.health.unrunnable', { count: health!.unrunnable })}
  </span>
)}
```

- [ ] **Step 6: Give the create form an error path — it has none today**

`handleCreate` currently calls `await api.post('/scheduler/jobs', body)` with **no `try`/`catch` at all**. On a rejected POST the function throws, `setShowCreate(false)` never runs, the dialog just sits there, and the user is told nothing.

That is tolerable only while the endpoint never rejects a well-formed body. Task 7 makes a typo'd cron a 400 — so without this step, the feature would introduce exactly the kind of silent failure it exists to remove. Create the path:

Add the state beside the other `useState` calls in the component:

```tsx
const [createError, setCreateError] = useState<string | null>(null)
```

Wrap the POST in `handleCreate`, and return early on failure so the form stays open with its values intact:

```tsx
    setCreateError(null)
    try {
      await api.post('/scheduler/jobs', body)
    } catch (err) {
      // api.ts throws ApiError(status, data.error ?? data.message ?? statusText),
      // so a 400 here is our own "Unschedulable …" message from Task 7.
      const status = (err as { status?: number }).status
      const message = (err as { message?: string }).message
      setCreateError(
        status === 400
          ? t('scheduler.error.unschedulable')
          : (message ?? t('scheduler.error.unschedulable')),
      )
      return
    }
    setShowCreate(false)
```

Render it in the create dialog, directly above the submit button:

```tsx
{createError && <div className="text-xs text-red-400">{createError}</div>}
```

Also clear it when the dialog is opened or cancelled, so a stale message never greets the next attempt.

- [ ] **Step 7: Stop "Run Now" from being a dead button**

Task 7 makes `POST /scheduler/jobs/:id/run` answer **409** when a job cannot run. `handleRunNow` has no `catch`, and its call site is `onClick={() => void handleRunNow(job.id)}` — `void` swallows the rejection outright. Left alone, the user would click Run Now on a broken job and see **nothing at all**: we would have traded a false success for silence, which is the same defect class this feature exists to remove.

The primary fix is not the toast — the row already knows the answer. `job.runnability` arrives with the list response, so disable the button and say why:

```tsx
<Button
  variant="ghost"
  size="icon"
  className="h-7 w-7"
  disabled={
    isFaulted(job) || job.status === 'disabled' || job.status === 'dead_letter'
  }
  title={
    job.runnability?.fault
      ? t(faultTooltipKey(job.runnability.fault), { detail: job.runnability.detail })
      : t('scheduler.runNow')
  }
  onClick={() => void handleRunNow(job.id)}
>
  <Play className="h-3.5 w-3.5" />
</Button>
```

Then keep a catch as the backstop, for the case where the job broke between the list being fetched and the click:

```tsx
import { toast } from 'sonner'   // already used elsewhere in this app, e.g. pages/board/board-list.tsx

const handleRunNow = async (id: string) => {
  try {
    await api.post(`/scheduler/jobs/${id}/run`)
  } catch (err) {
    const status = (err as { status?: number }).status
    // 409 = the server refused because the job cannot run. api.ts's ApiError
    // carries only status + message, not the response body, so use the
    // translated generic line rather than the server's English text.
    toast.error(status === 409 ? t('scheduler.error.cannotRun') : t('common.unknownError'))
    return
  }
  refreshAll()
}
```

Note `refreshAll()` moves inside the success path — today it runs unconditionally, which would refresh away the very state that explains the failure.

- [ ] **Step 8: Run the web tests and lint**

Run: `bun vitest run tests/web`
Expected: the new file passes. `docs-help.test.ts` fails for a pre-existing reason — ignore it.

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

- [ ] **Step 9: Full suite**

Run: `bun vitest run 2>&1 | tail -5`
Expected: 58 failures, all pre-existing (`wip_limit`, `working_directories`, `docs-help`). Any other failure is yours.

---

### Task 10: Stop the agent tools reporting runs that did not happen

**Why this exists:** `scheduler.run()` has three callers. Task 7 fixed the HTTP route and Task 9 fixed the UI button. The third is `schedule_run` in the agent tool registry, and it is the worst of the three:

```ts
await scheduler.run(String(input.jobId), 'agent')
return { ran: true, jobId: input.jobId }
```

`ran: true` unconditionally — including when `executeJob` declines because the job is disabled, dead-lettered, or has no handler. A human at least sees the UI; an agent **acts on this answer**, reports success, and moves on in its plan. Agents are also blind to runnability entirely, because `schedule_list` calls the service's `list()` with its own filter and never asks for it.

**Files:**
- Modify: `src/modules/tools/builtin/schedule-tools.ts`
- Test: `tests/modules/tools/schedule-tools-runnability.test.ts`

**Interfaces:**
- Consumes: `scheduler.getRunnability(job)`, `scheduler.get(id)`, `list({ includeRunnability: true })` — all from Tasks 2 and 6.
- Produces: nothing downstream. This is the last task.

- [ ] **Step 1: Write the failing test**

Create `tests/modules/tools/schedule-tools-runnability.test.ts`. Build the scheduler with `ensureSchedulerTables(db)` and `createSchedulerService(db, mockLogger)` exactly as `tests/modules/scheduler/execution-log-skips.test.ts` does, register `real.handler`, create a healthy job and an `Orphan` whose stored handler is then rewritten to `gone.handler`, and drive the tools through whatever registration function `schedule-tools.ts` exports. **Read that file first to learn its actual export shape and how a tool is invoked — do not assume.**

```ts
describe('schedule_run truthfulness', () => {
  it('does not claim a run for a job with no handler', async () => {
    const result = await runTool('schedule_run', { jobId: brokenId })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('no_handler')
  })

  it('still reports ran:true for a healthy job', async () => {
    const result = await runTool('schedule_run', { jobId: goodId })
    expect(result.ran).toBe(true)
  })

  it('does not claim a run for a disabled job', async () => {
    scheduler.pause(goodId)
    scheduler.update(goodId, { status: 'disabled' })
    const result = await runTool('schedule_run', { jobId: goodId })
    expect(result.ran).toBe(false)
  })
})

describe('schedule_list exposes runnability', () => {
  it('reports why a job cannot run', async () => {
    const result = await runTool('schedule_list', {})
    const broken = result.jobs.find((j: any) => j.id === brokenId)
    expect(broken.runnable).toBe(false)
    expect(broken.fault).toBe('no_handler')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun vitest run tests/modules/tools/schedule-tools-runnability.test.ts`
Expected: FAIL — `ran` is `true` for the broken job.

- [ ] **Step 3: Make `schedule_run` truthful**

```ts
      execute: async (input) => {
        const scheduler = getScheduler()
        if (!scheduler?.run) return NOT_READY
        const job = scheduler.get?.(String(input.jobId))
        if (!job) return { ran: false, jobId: input.jobId, reason: 'not_found' }

        // Do not claim a run that executeJob would silently decline. An agent
        // acts on this answer — it will report success and move on.
        if (job.status === 'disabled' || job.status === 'dead_letter') {
          return { ran: false, jobId: input.jobId, reason: job.status }
        }
        const runnability = scheduler.getRunnability?.(job)
        if (runnability && !runnability.runnable) {
          return { ran: false, jobId: input.jobId, reason: runnability.fault, detail: runnability.detail }
        }

        await scheduler.run(String(input.jobId), 'agent')
        return { ran: true, jobId: input.jobId }
      },
```

Guard every new call with `?.` as the surrounding code does — this module reaches the scheduler lazily and tolerates it not being ready.

- [ ] **Step 4: Let `schedule_list` report runnability**

Add `includeRunnability: true` to the filter `schedule_list` passes to `scheduler.list(...)`, then add `runnable` and `fault` to the keys its output builder whitelists. **That builder whitelists rather than spreads** — adding the filter flag alone changes nothing visible, which is the mistake to avoid here.

- [ ] **Step 5: Run the tests**

Run: `bun vitest run tests/modules/tools tests/modules/scheduler`
Expected: all pass, including every pre-existing tools test.

- [ ] **Step 6: Lint**

Run: `bun run lint 2>&1 | grep -c 'error TS'` — expect `52`.

---

### Task 11: Update the user documentation

**Why this exists:** `packages/docs/src/content/docs/<lang>/automation/scheduler.md` is the user-facing Scheduler page, published at `/docs/`, and it exists in all six languages. This feature changes behaviour that three of its sections document. Leaving them is not a cosmetic gap — the documentation would describe a UI that no longer exists, which is the same "the system says one thing and does another" problem the whole feature addresses.

Do this task LAST, after Task 9 is reviewed, so the wording matches the labels that actually shipped.

**Files:**
- Modify: `packages/docs/src/content/docs/{en,hu,de,es,fr,tlh}/automation/scheduler.md`

**Interfaces:**
- Consumes: the six locale files from Task 9 — the doc wording must match the badge and chip labels actually rendered. Read `src/web/src/pages/scheduler/locales/en.json` (and each language's file) before writing that language's docs.

- [ ] **Step 1: Read what shipped**

Read `src/web/src/pages/scheduler/scheduler-page.tsx` and all six locale files. The doc must describe the real labels, not the plan's drafts. If Task 9's implementer changed any wording, the docs follow the code, not this plan.

- [ ] **Step 2: `## Create job`**

Add a note under the table, in each language, saying that an invalid cron expression or an interval below one second is now rejected when you press Create, with the reason shown on the form — previously such a job was created and silently never ran. Also note that an **Event** trigger is accepted but does not fire on its own yet; such a job is marked as unable to run.

- [ ] **Step 3: `## Job row actions / stats`**

Add two rows to the table and one note:

| Control | Meaning |
|---------|---------|
| **Cannot-run badge** | Shown when a job cannot execute — no handler, an unsupported trigger type, or a schedule that could not be armed. Hover for the cause. |

Change the **Run Now** row to say it is disabled when the job cannot run, with the reason in the tooltip.

Note under the table: **Show infrastructure jobs** never hides a job that cannot run — a broken system job stays visible even with the filter off. That rule is the point of the feature; state it explicitly.

- [ ] **Step 4: `## Health strip`**

Add one row:

| **N cannot run** | Jobs that will not execute as configured |

- [ ] **Step 5: Verify all six**

Confirm each of the six files got the same structural additions, and that the wording in each matches that language's locale strings rather than being an English paste. Klingon follows the terse register the existing file already uses.

Run: `bun run docs:build`
Expected: builds without error. (It runs automatically on server start, so a broken docs tree would surface late otherwise.)

- [ ] **Step 6: Confirm nothing else moved**

Run: `git status --short packages/docs/src` — exactly six files modified, nothing else. Do not commit.

---

## Out of scope

Do not do these, even if you notice them:

- Bridging `scheduler.job.*` events to `eyas.*` so audit sees them.
- Adding `job_id` to `ai_traces` for cost attribution.
- Implementing `event` / `webhook` trigger arming.
- Retry/backoff on failure.
- Reviving or deleting `src/modules/scheduler/schema.ts` beyond keeping the two new columns in step.
- Fixing `observability/index.ts:112`. It never creates a job row, so this feature cannot detect it — see spec §12.4.
- The 58 pre-existing test failures.
