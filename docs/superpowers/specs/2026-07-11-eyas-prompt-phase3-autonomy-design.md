# EYAS Prompt System — Phase 3 (Autonomy Engine) Design Spec

**Date:** 2026-07-11
**Status:** Design approved (direction) — ready to write the implementation plan
**Depends on:** Phase 1 (wiring) + Phase 2 (content), both on `main`. The base prompt now carries the proactive + self-improvement clauses; Phase 3 makes the *loops* that act on them genuinely model-driven.
**Parent design:** `docs/superpowers/specs/2026-07-11-eyas-prompt-system-design.md` §7.

---

## 1. Context — the autonomy loop landscape (from source discovery)

Five self-improvement/proactivity loops exist; most are inert or string-templated. The **reflection pass is the one fully-built model-in-the-loop** (memory/index.ts:263-275 `summarize` closure + reflection-engine): config-gated OFF, a 0-token activity gate, cheap `heartbeat`-tier routing, `ctx.model.complete` with maxTokens/temperature caps, fail-open. **This is the reference pattern every new loop copies** (also mirrored in `memory/consolidator/semantic-promoter.ts`).

| Loop | Today | Model hook point |
|---|---|---|
| **Heartbeat** (proactive-assistant) | Composer does NOT exist — `notify()` (index.ts:92-105) string-joins machine labels into a canned "items may need your attention" alert. 0-token `shouldNotify` gate works. | the `notify(signals, reasons)` callback |
| **Reflection** (memory) | Fully model-driven but display-only: 3 flat lists → morning briefing consumed by NOTHING; no target/type/confidence/evidence. | `buildReflectionBuckets` / `buildReflectionPrompt` |
| **Forge** (forge) | Wired but inert: feedback source `tools:executed` is emitted NOWHERE in prod (signal starved); `proposedValue` is string-concat; `betterApproach`/`topSuggestions` READ but never WRITTEN; **auto-applies proposals ≥0.95 confidence**. | `proposal-engine.generateFromFriction()` |
| **Self-learning** (self-learning) | Cron, 0 tokens: 3 SQL aggregates → a CONSTANT generic `suggestedValue` per anomaly; outputs go to dead-ends (nothing applies them). Apply infra exists but unwired. | the 3 `insights.push({...})` sites in `execution-learner.ts` |
| **Skill/agent creation** | skill-generation module DORMANT (onStart no-op, unreachable routes); consolidator skill-miner STUBBED (detection-only placeholders); `propose_agent_creation` tool is live. | `skill-generator.generate()` |

**Critical architectural constraint discovered:** there is **NO runtime config-write API** — Zod config flags are read once at `onStart` and only change via editing YAML + restart. So a YAML flag **cannot** be a "one-click enable." Worse, unknown keys are stripped by `z.object`, so `proactive.*`/`forge.*` flags can't even be set from YAML today. **But** a DB-backed runtime autonomy layer (`autonomy_categories`, security-gate) IS mutable at runtime and has UI. Enablement must ride that layer (§4.2).

---

## 2. Decisions

| # | Decision | Choice |
|---|----------|--------|
| A1 | Scope | **Full engine** — 3A composer/author passes + 3B improvement-bridge & gated apply + 3C enablement UX |
| A2 | Behavior-change safety | **Propose + approval-gate** — every prompt/skill/routing/soul change is a PROPOSAL routed through the existing approval ladder (`autonomy_categories` / `createApproval` / security-gate). Forge's current ≥0.95 auto-apply is moved behind the gate. NO loop autonomously changes agent behavior without owner approval. |
| A3 | Cost posture (all loops) | Cheap `heartbeat` tier + a deterministic 0-token activity gate first + fail-open (degrade to the current canned/deterministic result on any model error). maxTokens/temperature caps. |
| A4 | Default posture | **OFF by default** (privacy/cost) + a strong onboarding nudge + **one-click enable via the runtime autonomy layer** (Phase 1 Q3). |

---

## 3. Cross-cutting foundations (build first)

### 3.0 Shared composer pattern (`makeComposer`)
Every author/compose pass follows the reflection/semantic-promoter template. Extract a tiny shared helper so the four passes don't each re-implement it:
```
async function runCheapModelPass(ctx, { system, user, maxTokens, temperature, fallback }): Promise<string> {
  // 1. resolve cheap tier, fail-open: decisionEngine.resolveForTier('heartbeat') in try/catch
  // 2. ctx.model.complete({ provider, model, messages:[{system},{user}], maxTokens, temperature })
  // 3. extractResponseText; on any throw / empty → return fallback
}
```
Guard `ctx.model` / `ctx.decisionEngine` presence (fail-open to `fallback` when the model module isn't reachable — mirror `memory/index.ts:265-266`). This helper is the single place cost caps + fail-open live.

### 3.1 Approval gate for behavior changes
All behavior-changing applies (self-learning prompt/constraint edit, forge description/soul change, skill adoption, model-routing edit) go through the existing autonomy ladder: resolve the change's autonomy category; at the gated level **enqueue `createApproval(...)`** (owner approves in the existing queue) rather than executing. Never bypass the locked floor. Forge's ≥0.95 auto-apply is replaced by this gate. Apply happens only on owner approval (or, later, an explicitly-raised autonomy level — out of scope now).

### 3.2 Runtime enablement (the "one-click enable" answer)
Because there is no runtime config-write API, each Phase-3 loop's enabled state is a **DB-backed runtime autonomy category** (reuse the `autonomy_categories` mechanism the security-gate already exposes + its UI/route), checked at **fire time** (not only `onStart`), default OFF. This gives one-click enable without restart. Additionally, **fix the Zod schema gap** so `proactive.*` / `forge.*` / the loop flags are valid keys (not stripped) — so headless/ops deployments can also set them in YAML. Precedence: runtime autonomy level wins; YAML flag is the headless default.

---

## 4. Phase 3A — Composer / author passes (model-driven output, no autonomous behavior change)

Each is OFF-default, cheap-tier, 0-token-gated, fail-open. They make the loop's *output* genuinely model-authored; none changes agent behavior autonomously.

- **3A.1 Heartbeat composer** — build the missing composer inside `proactive-assistant/index.ts` `notify(signals, reasons)`: a cheap-tier pass turns the structured signals into a 1–3 sentence, human-voiced briefing (using the base voice), fail-open to the current canned title/body. Thread `ctx.model` + `decisionEngine` into the module (add `model` to its optional deps, guard fail-open). Also collect the 3 currently-declared-but-unpopulated signals (boardDueSoon / schedulerFailures / memoryPending) or drop them.
- **3A.2 Reflection enrichment** — extend `buildReflectionPrompt` + `ParsedReflection` with a structured `improvements: ImprovementCandidate[]` channel (`{ target: 'tool'|'skill'|'prompt', targetId, friction, suggestion, confidence, evidenceSessions[] }`), and enrich `completedRuns` signals with per-run outcome. The reflection emits actionable, typed learnings — the input to 3B's bridge.
- **3A.3 Forge authoring pass** — in `proposal-engine.generateFromFriction()`, replace the `proposedValue` string-concat with a cheap-tier pass that reads the target's CURRENT description/prompt + the raw sample friction texts and authors a concrete improved value; and synthesize `betterApproach` from raw friction during the scan (closes the READ-but-never-WRITTEN gap). Make `generateFromFriction` async; thread `model`+`decisionEngine` into `ProposalEngineDeps`.
- **3A.4 Skill authoring pass** — add a summariser port to `skill-generator.generate()`: turn a `SkillCandidate` (tool chain, input schemas, observation stats, session goals) into a real name/description/whenToInvoke + a genuine procedural body, validated by `SkillFrontmatterSchema`, deterministic renderer kept as fallback.

## 5. Phase 3B — Improvement bridge + gated apply

- **3B.1 Revive the feedback source** — emit `tools:executed` from `tools/tool-executor.ts` on every tool run (success/error), so forge's auto-scrape actually receives a live signal (today it's emitted only in a test). Without this, no scan ever finds patterns.
- **3B.2 Wire the bridge** — route reflection's `ImprovementCandidate[]` (3A.2) into the forge feedback/friction store and self-learning, so a reflected friction becomes a `ForgeProposal` and a metric anomaly becomes a concrete candidate — the "reflect → propose improvement" loop the base prompt now tells agents to do.
- **3B.3 Self-learning concrete edits** — thread `model`+`decisionEngine`+`agentRegistry` into `createExecutionLearner`; make `learn()` async; per anomaly, feed the agent's ACTUAL current systemPrompt/constraints (or tool/routing rule) + the metric to a cheap-tier pass that emits a concrete patch (not the generic sentence). Output = a PROPOSAL.
- **3B.4 Gated apply** — every 3B proposal (forge, self-learning, skill adoption) is applied ONLY via the §3.1 approval gate. Replace forge's ≥0.95 auto-apply with the gate. The apply mechanics already exist (`agentRegistry.update`, `modelRouter.updateRule`, the skills registry adopt path) — wire them behind approval.

## 6. Phase 3C — Enablement UX

- **3C.1 Runtime enable** — register each loop as a runtime autonomy category (§3.2), OFF by default; a PATCH/toggle route + a Settings UI card ("Autonomy & self-improvement") to enable each loop one-click, no restart.
- **3C.2 Onboarding nudge** — a post-setup dashboard card (or a setup step) that explains what the proactive/self-improvement loops do, the cost/privacy trade-off, and offers one-click enable. Honest, opt-in, vendor-neutral.
- **3C.3 Schema fix** — add the missing Zod entries so `proactive.*`/`forge.*`/loop flags aren't stripped (headless default path).

---

## 7. Constraints
- No version bump. Per-task commits authorized for the execution run; nothing pushed without explicit request; no `Co-Authored-By` trailer; commits exclude `config/default.yaml`/`docs/`.
- Vendor-neutral English; no eyssen.com/Odoo coupling.
- Every loop: OFF by default, cheap-tier, 0-token activity gate, fail-open, cost caps. No loop spends on an idle tick. No behavior change without the approval gate.
- The mandatory devils-advocate lens runs across the whole engine: cost runaways, autonomy-gate bypass, prompt-injection via reflected/learned content, and fail-open correctness.

## 8. Risks & Open items (decided defaults; adjust at plan time)
- **R1 — Autonomy-category API fit:** §3.2 assumes `autonomy_categories` supports a per-loop runtime on/off (level) mutable via an existing route/UI. Confirm the exact API at plan time; if it only models L1/L2 action-risk (not feature-enable), add a minimal DB-backed `autonomy_features` flag table + PATCH route instead (still runtime, still one-click). Either way: NO YAML-only enable.
- **R2 — Cost:** four cheap-tier passes on cron + a live `tools:executed` stream. The 0-token gate + cheap tier + fail-open bound it; add a per-loop daily call cap. Flag any loop that could fire a paid call on an idle system.
- **R3 — Injection/safety:** reflected/scraped friction text and learned metrics become model inputs and then PROPOSALS; the approval gate is the backstop (nothing auto-applies). Treat all such content as untrusted data, never instructions.
- **R4 — Scope size:** the full engine is large; the plan will sequence 3A (foundations + composers) → 3B (bridge + gated apply) → 3C (enablement), each independently testable, with the phase gate after the whole engine (or sub-gates if it runs long).

## 9. Verification
- Each pass: a test that with the loop enabled + a stub model it produces a model-authored artifact, and with the model absent/erroring it fails open to the current deterministic result; a test that the loop is OFF by default (no model call on a fresh install).
- 3B: a test that a proposal is ENQUEUED for approval, not auto-applied; that forge no longer auto-applies ≥0.95; that `tools:executed` now fires from the executor.
- 3C: a test that the runtime toggle enables a loop without restart (reads the runtime flag at fire time).
- Full suite green + typechecks clean before the gate; no version bump; per-task commits; nothing pushed without request.
