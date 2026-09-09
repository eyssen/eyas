# EYAS Prompt System — Phase 3 (Autonomy Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the proactivity/self-improvement loops genuinely model-in-the-loop: heartbeat composer, reflection enrichment, forge + skill authoring, a revived feedback→propose→gated-apply bridge, and runtime one-click enablement — all OFF by default, cheap-tier, fail-open, and (for behavior changes) behind the approval gate.

**Architecture:** Every model pass copies the proven reference (`memory/consolidator/semantic-promoter.ts` / `memory/index.ts:263-275`): a deterministic 0-token activity gate first, then `decisionEngine.resolveForTier('heartbeat')` → `gateway.complete(...)` → `extractResponseText`, wrapped in try/catch that **fails open** to the current deterministic result. Enablement + gating reuse the existing runtime-mutable `autonomy_categories` (security-gate) — no new config-write API.

**Tech Stack:** Bun + TS (strict, ESM), Drizzle/bun:sqlite, Vitest, React (settings UI).

## Global Constraints
- No version bump. Per-task commits authorized for THIS run: stage ONLY each task's files (`git add <file>…`, never `-A`/`-a`/`.`), NEVER stage `config/default.yaml` or `docs/`, conventional subject, **NO `Co-Authored-By` trailer**, do NOT push. Commit then report.
- Vendor-neutral English. No eyssen.com/Odoo coupling.
- Tests under `tests/**`. DB tests: `bun run node_modules/.bin/vitest run <path>`. Backend typecheck `bun run lint`; web `bunx tsc --noEmit -p tsconfig.json` (in src/web).
- **Every loop: OFF by default, cheap `heartbeat` tier, 0-token activity gate BEFORE any model call, fail-open, maxTokens/temperature caps.** No paid call on an idle tick.
- **No behavior change without the approval gate** (`autonomyPolicy.createApproval`), except where already owner-approved via autonomy level.

## Key APIs (verified in source — use these)
- Reference pass: `memory/consolidator/semantic-promoter.ts:98-117` — `decisionEngine?.resolveForTier('heartbeat')` (try/catch) → `gateway.complete({ messages, system, maxTokens, temperature, ...(resolved?{provider,model}:{}) })` → `extractResponseText(resp)`; `logger?.warn` + fail-open on error.
- Gateway: `ctx.model.complete(request: ModelRequest): Promise<ModelResponse>` (gateway.ts:99).
- Decision engine: `(ctx as any).decisionEngine.resolveForTier(tier): {provider,model} | undefined` (decision-engine.ts:180).
- Autonomy policy (`createAutonomyPolicy(db)` at `(ctx as any).securityGate.autonomyPolicy`): `resolve(key): ResolvedAutonomy`, `listCategories()`, `setLevel(key, level, actor)`, `createApproval(input)`, `listApprovals(status)`, `decide(id, status, actor)`. **The `autonomy_categories` ladder is action-RISK autonomy: `level IN (1,2,3)`, 1 = strictest floor. It has NO "off" rung and is a security-critical shared surface — DO NOT widen it.** Use it only for the APPLY gate (Task 9: `createApproval`).
- **Loop enable/disable → a SEPARATE minimal feature-flag store** (built in Task 1): `autonomy_features (key TEXT PK, enabled INTEGER DEFAULT 0, …)`, exposed at `(ctx as any).securityGate.features` with `isEnabled(key): boolean` (read FRESH at fire time), `setEnabled(key, on, actor)`, `list()`. Loop keys: `proactive.heartbeat`, `memory.reflection`, `forge.apply`, `selfLearning.apply`, `skill.adopt`. This is the runtime one-click enable (default OFF), NOT the ladder.

---

## Task 1 — Foundations: shared cheap-model pass + autonomy categories
**Files:** Create `src/modules/model/cheap-pass.ts` (or `src/shared/`); modify the module that seeds autonomy categories (security-gate/autonomy-policy.ts seed block, or a registration call). Test: `tests/modules/model/cheap-pass.test.ts`.
**Produces:** `runCheapModelPass(ctx, opts): Promise<string>` and the seeded Phase-3 category keys.
- [ ] Write failing test: with a stub `ctx.model.complete` returning text, `runCheapModelPass` returns it; with `ctx.model` absent OR `complete` throwing OR empty output, returns `opts.fallback`. Never throws.
- [ ] Implement `runCheapModelPass(ctx, { system, user, maxTokens=200, temperature=0.4, fallback })`: resolve `(ctx as any).decisionEngine?.resolveForTier('heartbeat')` in try/catch; if `ctx.model?.complete` missing → return fallback; call `complete({ messages:[{role:'system',content:system},{role:'user',content:user}], maxTokens, temperature, ...(resolved?{provider:resolved.provider,model:resolved.model}:{}) })`; extract text (reuse/port `extractResponseText`); on any throw/empty → `logger?.warn` + return fallback. This is the ONLY place cost caps + fail-open live.
- [ ] Build a SEPARATE feature-flag store `src/modules/security-gate/autonomy-features.ts` (`createAutonomyFeatures(db)`: table `autonomy_features (key TEXT PK, enabled INTEGER NOT NULL DEFAULT 0, updated_at, updated_by)`; INSERT OR IGNORE seed the 5 loop keys enabled=0; `isEnabled(key)` read-fresh, `setEnabled(key,on,actor)`, `list()`). Wire it in security-gate/index.ts and expose at `(ctx as any).securityGate.features`. **Do NOT touch `autonomy-policy.ts` / `autonomy_categories`** (the ladder is `1|2|3`, no "off"; it's the apply-gate surface, not feature-enable — spec R1 fallback).
- [ ] Run, verify, commit `feat(autonomy): shared cheap-model pass helper + Phase-3 autonomy feature flags`. Report.

## Task 2 — Heartbeat composer (3A.1)
**Files:** `src/modules/proactive-assistant/index.ts` (the `notify` callback, lines ~92-105; add `model` to reachable deps), `heartbeat.ts` (collect the 3 unpopulated signals or drop them). Test: `tests/modules/proactive-assistant/heartbeat-composer.test.ts`.
- [ ] Failing test: `notify(signals, reasons)` with a stub model produces a composed human-voiced alert title/body; with model absent/erroring, falls back to the current canned title `'Heartbeat: items may need your attention'` + `reasons.join('\n')`.
- [ ] In `notify`, before building the alert, call `runCheapModelPass(ctx, { system: <voice: warm, terse briefing>, user: <signals+reasons>, maxTokens:200, fallback: cannedBody })`; use its text for the alert body (+ a short composed title), fail-open to canned. Read `ctx.model`/`decisionEngine` fail-open. Keep the 0-token `shouldNotify` gate unchanged (composer only runs when the gate already passed). Gate on the `proactive.heartbeat` autonomy level > 0 (in addition to the existing config flag — Task 10 makes the level the primary switch).
- [ ] Run, verify, commit `feat(proactive): model-in-the-loop heartbeat composer (fail-open)`. Report.

## Task 3 — Reflection enrichment (3A.2)
**Files:** `src/modules/memory/reflection-engine.ts` (`buildReflectionPrompt` ~51-67, `ParsedReflection` ~35-39, `buildReflectionBuckets` ~89-120), enrich the `completedRuns` signal source. Test: `tests/modules/memory/reflection-improvements.test.ts`.
**Produces:** `interface ImprovementCandidate { target: 'tool'|'skill'|'prompt'; targetId: string; friction: string; suggestion: string; confidence: number; evidenceSessions: string[] }` (export it — Task 7 consumes it).
- [ ] Failing test: given signals with a failing tool pattern, the parsed reflection includes an `improvements: ImprovementCandidate[]` with a typed entry (parsed from the model's JSON channel), and a stub/erroring model fails open to the current 3-list digest with `improvements: []`.
- [ ] Extend `buildReflectionPrompt` to ask for a 4th JSON channel `improvements`; extend `ParsedReflection` + the parser; keep the deterministic buckets. Enrich `completedRuns` with per-run outcome (success/error, toolNames) so the model has evidence. Fail-open unchanged.
- [ ] Run, verify, commit `feat(memory): reflection emits structured improvement candidates`. Report.

## Task 4 — Forge authoring pass (3A.3)
**Files:** `src/modules/forge/proposal-engine.ts` (`generateFromFriction`, proposedValue concat ~33-35 → make async), `ProposalEngineDeps` (~8-11 add `model`/`decisionEngine`), `friction-analyzer.ts` (synthesize `betterApproach`), `forge/index.ts` (pass deps). Test: `tests/modules/forge/authoring-pass.test.ts`.
- [ ] Failing test: `generateFromFriction` with a stub model authors a concrete `proposedValue` from the target's current description + raw friction samples; with model absent, falls back to the current string-concat. `betterApproach` is synthesized (no longer always empty).
- [ ] Make `generateFromFriction` async; thread `model`+`decisionEngine` via deps; replace the concat with `runCheapModelPass(...)` fed the CURRENT description/prompt + the RAW sample friction texts; synthesize `betterApproach` from raw friction during the scan. Fail-open to concat.
- [ ] Run, verify, commit `feat(forge): model-authored improvement proposals (fail-open)`. Report.

## Task 5 — Skill authoring pass (3A.4)
**Files:** `src/modules/skill-generation/skill-generator.ts` (`generate()` ~line 184, before `renderSkillMd`). Test: `tests/modules/skill-generation/authoring.test.ts`.
- [ ] Failing test: `generate(candidate)` with a stub model produces an authored SKILL.md (name/description/whenToInvoke + procedural body) that passes `SkillFrontmatterSchema`; with model absent/invalid output, falls back to the deterministic `renderSkillMd`.
- [ ] Add a summariser port: feed the `SkillCandidate` (tool chain, input schemas, observation stats, session goals) to `runCheapModelPass`, parse to `SkillFrontmatter`, validate via schema, fail-open to the deterministic renderer.
- [ ] Run, verify, commit `feat(skill-generation): model-authored SKILL.md (schema-validated, fail-open)`. Report.

## Task 6 — Revive the feedback source (3B.1)
**Files:** `src/modules/tools/tool-executor.ts` (`execute()` ~line 88). Test: `tests/modules/tools/tools-executed-event.test.ts`.
- [ ] Failing test: `execute()` emits `tools:executed` with `{ toolName, success, error? }` on both a successful run and a thrown/failed run.
- [ ] Emit `bus.emit('tools:executed', {...})` (via the executor's bus/ctx) after a tool run, success and error paths. Match the shape forge's auto-scrape reads (`target='tool'`, `useful`, `friction=error`).
- [ ] Run, verify, commit `fix(tools): emit tools:executed so forge feedback is live`. Report.

## Task 7 — Improvement bridge (3B.2)
**Files:** wire reflection's `ImprovementCandidate[]` (Task 3) into forge's feedback/friction store + self-learning input (in memory/index.ts reflection wiring or a small bridge). Test: `tests/modules/memory/reflection-forge-bridge.test.ts`.
- [ ] Failing test: a reflection with a `target:'tool'` improvement candidate results in a forge feedback/friction record (or a queued proposal input).
- [ ] After a reflection produces `improvements`, route each into the forge feedback path (`POST /forge/feedback` service call or the feedback-collector) and/or self-learning, so "reflect → propose improvement" is a live loop.
- [ ] Run, verify, commit `feat(memory): bridge reflection improvements into forge/self-learning`. Report.

## Task 8 — Self-learning concrete edits (3B.3)
**Files:** `src/modules/self-learning/execution-learner.ts` (the 3 `insights.push` sites; factory `createExecutionLearner(db)` → `(db, deps)`, `learn()` async), `self-learning/index.ts` (thread deps). Test: `tests/modules/self-learning/concrete-edits.test.ts`.
- [ ] Failing test: for a metric anomaly, `learn()` with a stub model + agentRegistry produces an insight whose `suggestedValue` is a CONCRETE patch (a rewritten prompt line / constraint / routing rule) referencing the agent's actual current systemPrompt; with model absent, falls back to the current generic sentence.
- [ ] Thread `{ gateway: ctx.model, decisionEngine, agentRegistry, logger }`; make `learn()` async; per anomaly, `runCheapModelPass` fed the agent's ACTUAL current systemPrompt/constraints (or tool/routing rule) + the metric → concrete patch as `suggestedValue`. Output is a PROPOSAL only (no apply here).
- [ ] Run, verify, commit `feat(self-learning): concrete model-authored edit proposals`. Report.

## Task 9 — Gated apply (3B.4)
**Files:** forge apply path (`soul-proposal-applier.ts` / proposal-store auto-apply), self-learning + skill adopt paths; route all through `autonomyPolicy.createApproval`. Test: `tests/modules/forge/gated-apply.test.ts` + self-learning/skill equivalents.
- [ ] Failing test: a forge proposal with confidence ≥0.95 is ENQUEUED via `createApproval` (status pending), NOT auto-applied; the same for a self-learning edit and a skill adoption. Owner `decide(id,'approved',actor)` then applies.
- [ ] Replace forge's ≥0.95 auto-apply with `createApproval({ category:'forge.apply', … })`. Route self-learning apply (`agentRegistry.update`/`modelRouter.updateRule`) and skill adoption through `createApproval` at the gated level. Apply mechanics fire only on approval. Never bypass the locked floor.
- [ ] Run, verify, commit `feat(autonomy): route all self-improvement applies through the approval gate`. Report.

## Task 10 — Runtime enable + schema fix (3C.1/3C.3)
**Files:** each loop's fire-time gate reads `(ctx as any).securityGate.features.isEnabled(key)`; `src/core/config/schema.ts` (add missing `proactive.*`/`forge.*`/loop Zod entries). Test: `tests/modules/security-gate/loop-enable.test.ts`.
- [ ] Failing test: with `autonomy_features` `proactive.heartbeat` enabled=0 the heartbeat composer/notify does not fire a model call; after `features.setEnabled('proactive.heartbeat', true, actor)` (no restart) it does — read at FIRE time, not cached at onStart. A fresh install has all 5 loop flags disabled.
- [ ] Each loop checks `features.isEnabled(key)` at fire time (OFF default). Add the missing Zod schema entries so `proactive.*`/`forge.*` YAML flags aren't stripped (headless default; the runtime feature flag wins).
- [ ] Add routes in `security-gate/routes.ts`: `GET /api/v1/autonomy/features` (→ `features.list()`) and `PATCH /api/v1/autonomy/features/:key` (body `{enabled:boolean}` → `features.setEnabled(key, enabled, actor)`), owner-permission-gated like the existing autonomy routes. Task 11's UI consumes these.
- [ ] Run, verify, commit `feat(autonomy): runtime per-loop enable via feature flags + routes + config schema fix`. Report.

## Task 11 — Onboarding nudge UI (3C.2)
**Files:** `src/web/src/pages/settings/` new "Autonomy & self-improvement" card (toggles each loop via the feature-flag PATCH route added in Task 10, e.g. `PATCH /api/v1/autonomy/features/:key {enabled}` → `features.setEnabled`); a post-setup dashboard nudge. Test: web typecheck + a light component/route test if a pattern exists. **NOTE:** Task 10 must add that PATCH route (security-gate/routes.ts) + a GET to list the flags; this task consumes them.
- [ ] A Settings card lists the Phase-3 loops with one-click enable (PATCH the feature flag), an honest cost/privacy note, vendor-neutral copy; a post-setup nudge card links to it. Run `bunx tsc --noEmit -p tsconfig.json` (web) + `bun run lint`.
- [ ] Commit `feat(web): autonomy & self-improvement settings card + onboarding nudge`. Report.

---

## Self-Review (plan vs spec)
- §3.0 helper → T1; §3.1 gate → T9; §3.2 enable → T1(seed)+T10; §3.3 schema → T10.
- 3A.1-4 → T2/T3/T4/T5; 3B.1-4 → T6/T7/T8/T9; 3C.1-3 → T10/T11/T10.
- No placeholders: each task names the exact hook file/function (from discovery) + the reference pattern + a fail-open acceptance test. Engine-logic tasks are spec-precise; implementers read the actual code + the semantic-promoter reference to apply the pattern (appropriate for pattern-application, not transcription).
- Types: `runCheapModelPass`, `ImprovementCandidate`, the autonomy category keys, `createApproval` — consistent across tasks.
- Sequencing: T1 (foundations) first; T2-5 (composers, independent); T6 (feedback) → T7 (bridge); T8; T9 (gated apply, depends on T4/T8/skill); T10 (enable, touches all loops' gates); T11 (UI). Devils-advocate lens on cost/gate-bypass/injection/fail-open across the whole engine at the final review.
