# Scheduler Runnability & Execution-Log Completeness — Design

**Date:** 2026-08-25
**Status:** Draft for review
**Module:** `scheduler` (with a read-only touch on `src/web/src/pages/scheduler`)
**Predecessor:** `docs/superpowers/specs/2026-08-24-context-inspector-skill-inventory-design.md`

---

## 1. Problem

EYAS runs 24 scheduled jobs seeded by 12 modules. Eleven of those modules are
toggleable. Today a job can be **declared, listed as `active`, drawn on the
timeline, and never execute once** — with no signal anywhere.

There are four independent ways to reach that state, and all four are silent:

| # | How a job becomes unrunnable | What the user sees today |
|---|---|---|
| 1 | Its module is disabled, so its handler is never registered | Nothing. The job row stays `active`. |
| 2 | Its trigger type is `event` or `webhook` — no code path arms those | Nothing. The UI prints a friendly `Event: x` label. |
| 3 | Its cron expression is invalid (a typo in the create form) | Nothing. The API returns **201 Created**. |
| 4 | Its interval is below the 1000 ms floor | Nothing. Same as #3. |

The execution log (`job_executions`) is not a reliable witness either, because
it has a hole in exactly the place these failures land.

## 2. Verified evidence

Every claim below was read from source, not inferred.

**2.1 — The missing-handler return is the only silent early exit.**
`scheduler-service.ts:137-141` logs a warning and returns. The two early exits
directly beneath it — concurrency limit (`:148-152`) and lock-held (`:156-162`)
— **both write a `job_executions` row** with status `skipped`. The asymmetry is
backwards: the two transient conditions are recorded, and the one permanent
condition ("this job is broken") is not.

**2.2 — The handler lookup is lazy, and that laziness is load-bearing.**
`executeJob` resolves the handler at *fire* time (`handlers.get(job.handler)`),
not at arm time. This is not a defect. `schedulerModule` is registered at
`bootstrap.ts:235`, and eight job-seeding modules register after it —
`self-learning` (238), `forge` (244), `communication` (247), `skills` (250),
`proactive-assistant` (259), `observability` (268), `skill-generation` (313),
`intel` (319) — accounting for roughly 14 of the 24 seeded jobs. Nothing
hard-depends on `scheduler` (`scheduler/index.ts:52`), so the topological sort
in `module-loader.resolveDependencies()` leaves it at its insertion position.

At `scheduler.start()` time the handler map is therefore **legitimately
incomplete**. Any design that refuses to arm a job whose handler is missing
would kill those ~14 jobs on every boot.

> **Binding consequence:** the arming logic must not change, and no runnability
> check may run inside `scheduler.onStart`.

**2.3 — Read time is safe.** `serve.ts` calls `bootstrap()` at `:90` and only
begins listening at `:145`. Every HTTP request is therefore served after
`startAll()` has completed and the handler map is final. Runnability can be
computed on read with no boot hook, no scheduled job, and no change to
`src/core/`.

**2.4 — Invalid cron is accepted.** `createJobSchema.cronExpression` is
`z.string().optional()` (`routes.ts:26`) with no syntax validation. On an
invalid expression `scheduleJob` throws, `scheduler-service.ts:311-313` catches
it and logs, and the route returns 201 with a job that will never run.

**2.5 — `next_run_at` is stale after any early exit.** It is refreshed in only
three places: `scheduleJob` (via `refreshNextRun`), after a successful run, and
after a failed run. None of the three early exits touches it. The field
therefore drifts after any skip, not only for broken jobs.

**2.6 — Volume risk is real.** Four jobs use `* * * * *`: `agent/index.ts:827`
and `:853`, `ops/index.ts:365`, `communication/index.ts:743`. A per-minute job
whose module is disabled fires 1440 times a day. Naively logging every silent
skip would produce ~129,600 rows inside the 90-day retention window, for one
job.

**2.7 — The scheduler is invisible to audit.** `audit/index.ts:28` subscribes to
`eyas.*`; the scheduler emits `scheduler.job.*`. Zero scheduler events reach the
audit log. *(Out of scope here — see §10.)*

**2.8 — A worked example lives in the codebase.** `observability/index.ts:112`
guards on `scheduler?.registerJob`, a method that does not exist on
`SchedulerService`, reached via `ctx.getModule('scheduler')`, which returns the
module definition rather than the service. The whole block sits inside an empty
`catch {}`. The hourly AI anomaly detection job it was meant to register **has
never run**. Eighteen lines below it, the context-detail purge job added on
2026-08-24 uses `(ctx as any).scheduler` and `registerHandler` correctly. Same
file, same module: one job alive, one dead, nothing to tell them apart.

## 3. Design principles

**3.1 — Three fields, three questions, no overlap.** The central rule of this
design is that a derived observation must never be written onto a field that
stores intent.

| Field | Answers | Written by |
|---|---|---|
| `status` | What does the user want? (`active`/`paused`/`disabled`/`dead_letter`) | A human, or an explicit documented rule |
| `next_run_at` | When is the next run declared for? | The scheduler, on **every** path |
| runnability | Can it execute at all, and if not, why? | Nobody — it is computed, never stored |

The `status` case is not hypothetical. Nearly all 24 seeds use this idempotency
shape:

```ts
if (!existing.some((j) => j.handler === 'proactive.heartbeat')) {
  scheduler.create({ ... })
}
```

If a disabled module's job were auto-set to `status = 'disabled'`, then on
re-enable the seeder would find the row, skip creation, and nothing would ever
set it back to `active`. The job would be permanently dead, killed by the
mechanism meant to protect it. **Runnability must therefore never mutate
`status`.**

The same argument rules out encoding runnability into `next_run_at` — by
nulling it, or by redefining `overdue` around it. `next_run_at = null` already
means "this is not a time-based trigger" (manual/event/webhook). Overloading it
would make the event-trigger case (#2, the worst offender) *less*
distinguishable, not more.

**3.2 — Derived, not stored.** Runnability is a pure function of (job row,
handler map, armed-timer maps). Computed on read it is always correct, cannot
drift, needs no migration, and — critically — **heals itself when a module is
re-enabled**, with no repair step.

**3.3 — Log transitions, not repetitions.** A transient condition is an event
and deserves a row per occurrence. A persistent condition is a state; it
deserves one row when it is first observed. "This job did not run 43,200 times"
is one fact, not 43,200 facts.

**3.4 — Evidence before inference.** Faults are ordered from most to least
fundamental, first match wins, mirroring `classify-skill.ts` from the
predecessor spec.

## 4. Runnability

New file: `src/modules/scheduler/runnability.ts` — a pure, dependency-free
module so it is unit-testable without a database or a live scheduler.

```ts
export type RunnabilityFault = 'no_handler' | 'unarmable_trigger' | 'not_armed'

export interface JobRunnability {
  runnable: boolean
  fault?: RunnabilityFault
  /** Human-actionable specifics: the missing handler name, the trigger type. */
  detail?: string
}

export interface RunnabilityEnv {
  hasHandler(name: string): boolean
  isArmed(jobId: string): boolean
}

export function evaluateRunnability(job: ScheduledJob, env: RunnabilityEnv): JobRunnability
```

### 4.1 Rules, in order

1. **`no_handler`** — `!env.hasHandler(job.handler)`.
   Evaluated for **every** status. A paused job with a missing handler is still
   broken; it will no-op the moment it is resumed or run manually.
   `detail` = the handler name.

2. **`unarmable_trigger`** — `triggerType` is `event` or `webhook`.
   Evaluated for every status. No code path in `scheduleJob` arms these, and
   nothing maps a declared event name to a bus subscription.
   **`manual` is exempt** — a manual job is correctly unarmed; it runs via
   `run(id)`. `detail` = the trigger type.

3. **`not_armed`** — `status === 'active'`, `triggerType` is `cron` or
   `interval`, the handler exists, and `!env.isArmed(job.id)`.
   Catches the invalid-cron (#3) and sub-second-interval (#4) cases.
   Restricted to `active` because a paused or disabled job is *correctly* not
   armed. `detail` = the trigger config.

Otherwise `{ runnable: true }`.

### 4.2 Deliberate non-faults

- **Non-leader node.** A follower arms its timers and skips at fire time
  (`scheduler-service.ts:299-302`). Correct multi-node behaviour, not a fault.
- **`status !== 'active'`.** Pausing is intent, not breakage. A paused job may
  still carry a `no_handler` or `unarmable_trigger` fault; it will never carry
  `not_armed`.

### 4.3 Service API additions

`isArmed` requires a new accessor, because `cronJobs` and `intervalTimers` are
closure-private. `hasHandler` is already public (`scheduler-service.ts:447`).

```ts
isArmed(jobId: string): boolean          // cronJobs.has(id) || intervalTimers.has(id)
getRunnability(job: ScheduledJob): JobRunnability
```

`list()` gains an opt-in enrichment flag rather than always computing, keeping
the hot path unchanged for callers that do not need it:
`list({ includeRunnability: true })`.

## 5. Execution-log completeness

### 5.1 Two new columns on `job_executions`

Added through the existing `migrateJobColumns` ALTER pattern
(`scheduler/index.ts:9-42`), which already tolerates re-runs.

| Column | Purpose |
|---|---|
| `skip_reason TEXT` | Why a `skipped` row exists: `concurrency`, `lock_held`, `no_handler` |
| `actor TEXT` | Who caused this run. `opts.actor` is accepted at `scheduler-service.ts:136`, passed in by `run()` at `:573`, and then **discarded**; `system` when a timer fired it |

Both are mirrored into `scheduler/schema.ts` so the (currently unused) Drizzle
definitions do not drift further. Reviving or deleting that file is out of
scope — see §10.

### 5.2 The missing-handler path gets a row

`scheduler-service.ts:137-141` becomes: write a `job_executions` row with
`status = 'skipped'`, `skip_reason = 'no_handler'`, emit
`scheduler.job.skipped`, refresh `next_run_at`, then return.

### 5.3 Dedup — the `no_handler` reason only

An in-memory `Set<string>` of job ids that have already logged a `no_handler`
skip **in this process**. At most one row per job per process lifetime.

`concurrency` and `lock_held` are **not** deduped: they are transient, and each
occurrence is genuinely informative. This asymmetry is §3.3 applied — a
transient condition is an event, a persistent condition is a state.

Rationale for the in-memory Set over a database check: it is exact for the
question being asked ("have we already recorded this since the handler map was
last built?"), costs nothing per fire, and resets on restart, which is the only
moment the handler map can change.

### 5.4 What is *not* logged

The non-leader skip (`:299-302`) stays unlogged. On a three-node cluster it
would triple the log volume to record the two nodes that correctly did nothing.

## 6. `next_run_at` repair

`refreshNextRun(job)` is called in all three early-exit paths — concurrency,
lock-held, and the new missing-handler path. Three one-line additions.

After this, `next_run_at` honestly answers its own question on every path, for
every job.

**Accepted consequence:** today a broken job's `next_run_at` freezes and drifts
into the past, which trips the `overdue` counter
(`scheduler-service.ts:728`) by accident. That accidental signal
disappears. It is replaced by the explicit runnability fault, which names the
job and the cause instead of incrementing an anonymous total. `overdue` returns
to meaning what it says: the scheduler is behind.

## 7. API surface

All under the existing `/api/v1` prefix and existing `requirePermission`
guards. No new permission subject.

**7.1** `GET /scheduler/jobs` and `GET /scheduler/jobs/:id` — `enrichJob()`
gains a `runnability` object on every job.

**7.2** `GET /scheduler/health` — gains `unrunnable: number`. The aggregate is
acceptable here **only because** the per-row detail exists; it is a summary, not
the signal.

**7.3** `POST /scheduler/jobs` and `PATCH /scheduler/jobs/:id` — reject an
unschedulable trigger with **400** instead of creating a silently-dead job.
Validation reuses the existing pure helper: for `cron` and `interval`,
`computeNextRunAt(triggerType, triggerConfig)` must return non-null. This closes
#3 and #4 at the source, which is the only place a user can be told about them
in time to fix the typo.

Existing rows are unaffected — this validates writes, not reads. A job that is
already broken surfaces through runnability instead.

**`event` and `webhook` are still accepted at create.** Only `cron` and
`interval` are validated, and the asymmetry is deliberate. An invalid cron
expression is a *mistake* — the user meant something valid and can fix it if
told in time. Choosing `event` is a *feature request*: the trigger type is
offered in the UI (`scheduler.trigger.event`, with an event-name field), and
rejecting it at the API would silently remove a documented affordance while
telling the user nothing about why. The runnability fault is the honest answer
here — the job is created as asked, and plainly marked as unable to fire.

## 8. UI surface

`src/web/src/pages/scheduler/`. Frontend ships with the backend, per project
policy.

**8.1 Per-row badge.** A job with a fault gets a badge on its own row, with the
cause in the tooltip. The aggregate `overdue: 3` chip in the header
(`scheduler-page.tsx:333`) is precisely the pattern to avoid: a number with no
way to reach the thing it counts.

**8.2 Unrunnable jobs ignore the infra filter.** `scheduler-page.tsx:148` hides
`source: 'system'` jobs unless "Show infrastructure jobs" is ticked. **A job
with a runnability fault is never hidden by that filter.** Without this rule the
feature would be invisible for exactly the jobs most likely to break — the
module-seeded ones — and the whole design would fail at its main use case.

**8.3 Health chip.** `unrunnable: N` in the header, which filters the list to
faulted jobs when clicked.

**8.4 Testable logic split.** Badge selection and filter-override logic go in a
plain `.ts` beside the `.tsx` (as `context-bar-occupancy.ts` and
`inventory-sort.ts` did), so they are unit-testable without a DOM.

## 9. Internationalisation

Every new user-facing string ships in all six locales — `en`, `hu`, `de`, `es`,
`fr`, `tlh` — under `src/web/src/pages/scheduler/locales/`, following the
existing flat `scheduler.*` key convention.

New keys: one label and one explanatory tooltip per fault
(`no_handler`, `unarmable_trigger`, `not_armed`), the `unrunnable` health chip,
and the 400-response messages surfaced in the create form.

Fault *codes* stay machine-readable in the API; only their presentation is
translated.

## 10. Explicitly out of scope

Named so they are decisions, not omissions:

- **Audit integration** (§2.7). Bridging `scheduler.job.*` to `eyas.*` touches
  the audit module and changes what gets persisted for every job event.
  Separate feature.
- **Cost attribution.** Adding `job_id` to `ai_traces` so a scheduled agent run
  is traceable to its cost. Touches `model` and `observability`. Separate
  feature.
- **Actually arming `event` and `webhook` triggers.** This design *detects and
  reports* them; implementing event-driven triggers is a feature in its own
  right.
- **Retry/backoff.** A failed job retries on its normal schedule with no
  backoff. Real, but unrelated to visibility.
- **The dead `scheduler/schema.ts`.** Nothing imports it; the live DDL is raw
  SQL in `index.ts`. This design keeps it in sync (§5.1) but does not resolve
  it.
- **Fixing `observability/index.ts:112`.** The anomaly job has never run
  (§2.8). It is a small fix in another module, and this design cannot help with
  it — see §12.4. Worth doing, separately.

## 11. Testing

- **`runnability.ts`** — pure-function tests over the rule table, no DB: each
  fault, precedence between them, the `manual` exemption, the `not_armed`
  status restriction, and non-leader-is-not-a-fault.
- **Service** — the missing-handler path writes exactly one row per process;
  a second fire adds none; `concurrency`/`lock_held` are not deduped;
  `next_run_at` advances on all three early exits; `actor` is persisted.
- **Routes** — invalid cron and sub-second interval return 400 on both POST and
  PATCH; valid ones still return 201/200; `runnability` is present in list and
  detail responses; `health.unrunnable` counts correctly.
- **Web** — badge selection per fault; a faulted system job survives the infra
  filter; a healthy system job does not.
- **Regression** — the existing scheduler suite must stay green. The 58
  currently-failing tests elsewhere in the repo (`wip_limit`,
  `working_directories`, `docs-help`) are pre-existing and out of scope.

## 12. Risks

**12.1 — The dedup Set hides a genuine re-break.** Entries are never evicted, so
within a single process a job that goes broken → repaired → broken again *under
the same handler name* gets no second row. Repointing the job at a **different**
missing handler IS logged, because the key includes the handler name; and the
handler map itself only changes at process start, since `registerHandler` never
removes. So the residual hole needs a handler to be registered mid-process,
which nothing does today. It is the price of §5.3 and is recorded deliberately.

**12.2 — `isArmed` exposes internal state.** It reveals timer-map membership through
the service API. Confined to a boolean, it leaks no object references and no
scheduling internals.

**12.3 — Losing the accidental `overdue` signal (§6).** Mitigated by the runnability
fault being strictly more informative — but it does mean §4 and §6 must ship
together. Shipping §6 alone would remove a signal and add nothing.

**12.4 — A job that was never declared cannot be detected.** This design
compares declarations against handlers, so its blind spot is a job that was
never written to `scheduled_jobs` at all. `observability/index.ts:112` is
exactly that case: `scheduler?.registerJob` is undefined, so the guard is
falsy, the block never executes, and **no job row is ever created**. The
anomaly job will therefore *not* appear as `no_handler` after this ships —
there is nothing to compare. Detecting "intended but never declared" would
require a registry of intent that does not exist and is not proposed here.
Stated so nobody later mistakes the silence for a clean bill of health.

**12.5 — The two transient declines are still not reported synchronously.**
`executeJob` can also decline for `concurrency` (four jobs already running) or
`lock_held` (another holder has the job lock). Neither is checked before
`scheduler.run()`, so `POST /scheduler/jobs/:id/run` still answers 200 and the
`schedule_run_now` agent tool still answers `{ ran: true }` in those cases.

Left deliberately, for three reasons. These two are transient races, not
persistent states, so a pre-check would be TOCTOU-stale by the time `run()`
executes — the correct fix is for `executeJob` to report its outcome, which is a
signature change across five call sites and deserves its own spec. The execution
log already records both truthfully (§5.1), so unlike the `no_handler` case the
information is not lost, only the synchronous return value is imprecise. And of
the two, `lock_held` means the job genuinely is executing, just not by this call.

Recorded so the gap is a decision with reasons rather than an oversight.

## 13. Global constraints

Carried into the implementation plan verbatim:

- TypeScript strict, ESM, English code and comments
- Pino for logging — never `console.log`
- Zod for all external input validation
- All six locales for every user-facing string: `en`, `hu`, `de`, `es`, `fr`, `tlh`
- CSS variables only — never hardcoded colours
- `/api/v1/` prefix; CASL permission check on every protected endpoint
- MIT-compatible dependencies only; no new dependency is required by this design
- **Do not change the version number** in `version.json`, `package.json`, or any
  HTML string
- **Do not commit, branch, or push** — the author commits explicitly
