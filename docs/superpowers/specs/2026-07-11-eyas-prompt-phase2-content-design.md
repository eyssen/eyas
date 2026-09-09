# EYAS Prompt System — Phase 2 (Authored Content) Design Spec

**Date:** 2026-07-11
**Status:** Design approved (direction) — ready to write the implementation plan
**Depends on:** Phase 1 (foundation) — shipped on `main` (`0770f98`). The wiring is live, so authored text now reaches the model on all four paths.
**Parent design:** `docs/superpowers/specs/2026-07-11-eyas-prompt-system-design.md` (§6 is this phase, expanded here).

---

## 1. Context

Phase 1 restored the wiring: one canonical, DB-seeded/editable identity + core-rules (+ voice, memory, team) now reaches interactive, background, team, and delegated runs. But the **content** is still Phase-1's minimal merge — the personality is stock-AI boilerplate, the seed agents are robotic checklists with `Ongoing proactive duties: (none)`, seed projects carry a NULL operating brief, and the setup wizard's onboarding copy is bare. This phase writes the actual proactive / human-like / efficient / self-improving text now that it has effect.

## 2. Decisions (from Phase-2 clarification)

| # | Decision | Choice |
|---|----------|--------|
| P1 | Base personality voice character | **Warm, distinctive** — a sharp, warm teammate, not a corporate assistant (see §4.1 for the exact seed text) |
| P2 | Proactivity + self-improvement in the ALWAYS-ON base text | **Strong but not excessive** — the base firmly encourages surfacing/taking the next step, flagging risks unprompted, and end-of-task reflection + friction-recording *when relevant*; concrete ongoing duties and actual autonomous action stay per-agent / loop-level (loops remain OFF-by-default from Phase 1) |
| P3 | Specialist (sub-agent) proactive duties | **Light** — domain-scoped anticipation within their lane; a sub-agent must not scope-creep beyond its task |
| P4 | Seed project operating brief | **Generic-helpful, vendor-neutral** — not tied to the owner's Odoo/eYssen world |
| P5 | Build order | base text (+ small wiring) → seed agents → seed projects → setup copy → guidance docs (optional, may trail) |

## 3. Goals & Non-Goals

### Goals
- The default agent, out of the box, reads as a real, proactive, self-improving teammate — not a generic bot.
- Every shipped seed agent has a genuine domain proactive duty and a self-improvement clause; the human "vibe" comes from the SOUL/voice layer, not a robotic checklist.
- The default project carries a real operating brief; the setup wizard onboards agents as proactive teammates with WHY-driven copy.
- Shipped-default seed-text changes (this phase, and future ones) **propagate to existing installs' un-edited rows**, while owner edits persist (see §4.2 — this generalizes Phase-1's one-time marker migration).

### Non-Goals
- No version bump. No `Co-Authored-By` trailer. Per-task commits are authorized for the execution run (as in Phase 1); nothing pushed without explicit request.
- Not building the Phase-3 autonomy engine (model-in-the-loop heartbeat/forge/reflection) — that is its own phase.
- No coupling of any default to eyssen.com / Odoo / a specific vendor. Product-identity eYssen references only.

## 4. Design

### 4.1 Base personality + identity text

**`Default Personality`** (the master-personality seed, DB-editable, inherited by every agent, refined per-agent by SOUL/voice). New canonical text:

```
## Default Personality

You're a sharp, warm teammate — not a corporate assistant.

- Lead with the answer; add the "why" only when it matters.
- Say things plainly, even when it stings. Skip the hedging and the flattery.
- Prefer doing over explaining, unless asked to explain.
- Proactive: when you see the next step, take it or name it — don't wait to be
  asked. Surface risks, blockers, and better options even when unprompted.
- Match depth to the task: one line for a small ask, real structure for a big one.
- Dry humor is fine when it lands; never forced.
- If you're unsure or can't verify something, say so. "I don't know" beats a
  confident guess.
- Respect the owner's time and budget: no filler, no repeating their words back,
  no explaining the obvious.
```

**Self-improvement clause** added to the canonical identity (`core-identity.ts`, DB-seeded/editable) — "strong but not excessive":

```
- Get better over time. At the end of a task, briefly reflect on what worked and
  what didn't. When a tool or skill underperforms, or you hit avoidable friction,
  record it so it can be improved. When you keep hitting the same capability gap,
  propose a new skill or a refinement instead of silently working around it — but
  don't let this reflection bloat a simple task.
```

(The identity already carries the proactive framing from Phase 1 — "You are NOT a passive chatbot… proactively pursue your mission". P2 strengthens the self-improvement half without over-mandating it on one-shot work.)

**Small wiring that rides with this content** (Phase 1 deferred it because personality had no real content yet):
- Add a `personality` input to `cache-prefix-builder.ts` and emit a `<default-personality>` tag (after `<core-rules>`, before `<project-context>`).
- Add a `personality` budget field to `token-budget.ts` `SectionBudget`.
- Extend the Phase-1 `resolveMasterSections` dep to also return `personality` (read `getMasterSection('personality')`, fall back to the code seed), and pass it into the prefix.
- **Make the master seeds static** (enables §4.2 and fixes a latent bug): `getMasterPrompt().identity` becomes exactly `CORE_IDENTITY` — drop the interpolated `EYAS ${version} — owner: ${ownerName} — date: ${currentDate}` header. Move the live version/owner/date into the `<runtime>` block (`RuntimeContext` + `resolveRuntime`), which is rendered per-turn. This also fixes a latent Phase-1 bug: the seeded identity froze the date at first-boot and served that stale date forever.
- Result: the warm-distinctive personality reaches the model, editing `master-personality` in the UI takes effect, and all three master seeds are stable strings (hashable for §4.2).

### 4.2 Shipped-default seed evolution — hash-set refresh (DECIDED)

Because Phase 1 made master sections DB-backed and stopped clobbering them on boot, a code change to the seed text no longer reaches an existing DB (INSERT OR IGNORE no-ops). Phase 1 handled this once with a marker-guarded refresh (`seed-migration.ts`). Phase 2 changes identity + personality text again, so we replace the ad-hoc marker approach with a durable, hash-based one (decision made — no longer open):

- Since §4.1 makes all three master seeds **static strings**, each shipped default has a stable SHA-256 hash. Maintain in code, per section (`identity`, `core-rules`, `personality`), a `KNOWN_PRIOR_SEEDS` set of the hashes of every previously-shipped static seed for that section.
- On boot, for each system-owned (`created_by='system'`) master row: if `sha256(content)` is in that section's `KNOWN_PRIOR_SEEDS` (i.e., it is an *un-edited* default from some prior version), UPDATE it to the current seed. If the hash is NOT in the set, it is an owner edit → leave it untouched.
- Preserves owner edits, propagates shipped-default evolution to un-edited rows, idempotent (after refresh `content == currentSeed`), and future-proof (each release that changes a seed just adds the previous version's hash to the set).
- **Legacy transition (one-time):** the Phase-1 `master-identity` rows carried a per-install `EYAS … — date:` header, so their hash is not fixed and won't be in `KNOWN_PRIOR_SEEDS`. Handle them with a single narrow body-signature guard in the same migration: if a system-owned `master-identity` row still contains the Phase-1 identity body signature (a distinctive stable sentence unique to the Phase-1 default, e.g. `You are EYAS, a self-hosted personal AI assistant platform`) **and** the header pattern, refresh it to the current static seed. This guard is removable in a later release once no header-ful rows remain.
- `seed-migration.ts` is generalized from `refreshStaleMasterSeeds` into `refreshMasterSeedsFromKnownDefaults(db, currentSeeds, knownPriorHashes)`; the Phase-1 marker `LIKE` clauses are subsumed by the hash set + the one legacy guard.

### 4.3 Seed agents (`agent-templates.ts`)

For the 2 primary + 13 specialist templates:
- **Proactive duties:** replace every `Ongoing proactive duties: (none)` with a genuine, domain-scoped duty. Primaries keep their richer ongoing duties (already present); specialists get a **light** one-liner anticipation within their lane (P3) — e.g. a code-reviewer surfaces adjacent risks it noticed while reviewing; a researcher flags a stronger source it found in passing. Never beyond the delegated task.
- **Self-improvement clause:** add a consistent short clause across templates — reflect on the outcome, record friction, and use the platform's skill-evolution/forge path when a capability gap recurs.
- **Voice over checklist:** lean on each template's SOUL/`soulStylePreset` + a real `Vibe` line for tone; trim the redundant style rules from the `systemPrompt` bodies now that the base personality + voice carry it. Keep the substantive domain rubric (what the specialist actually checks/does).
- Resolve the dead v1 fields: fold any still-useful `systemPrompt`/`role`/`goal`/`backstory` content into the shipped path or remove it, so there's one source per template.

### 4.4 Seed projects (`board/index.ts`)

- Give the default project(s) a real, generic-helpful operating brief in the `projects.prompt` column (currently NULL) — a vendor-neutral "how to work in this project" context that agents inherit via the project cascade (e.g. "This is the owner's general workspace. Prefer the internal board, memory, and knowledge base. Keep work organized as tasks; summarize outcomes.").
- Give project-**types** a one-paragraph prompt instead of a one-sentence description, so type-level context cascades meaningfully.

### 4.5 Setup wizard copy (`auth/index.ts` primary-agents step + setup pages)

- Rewrite the `primary-agents` step copy to be WHY-driven: frame the two agents as proactive teammates the owner will delegate to, with concrete examples, not "Name your main AI assistants".
- Fix the dead onboarding wiring flagged in the audit: **remove the dead `voice-profiles` frontend branch** (the `setup-page.tsx` branch + the unreachable, Hungarian-hardcoded `voice-step.tsx`) — DECIDED (voice is already tunable per-agent on the agent-detail page; a real setup-time voice step is a deferred future enhancement, noted in §5). Also fix `autoCompleteFromEnv` (`first-agent` → `primary-agents`, pass both names); i18n the English-only wizard copy to a single voice; de-duplicate the hardcoded team-agents list (fetch from the template source).

### 4.6 Guidance docs (optional, may trail)

Realign `config/skills/ai/prompting/*` and `config/skills/agent/agent-personas.md` to EYAS's real structures (IDENTITY.md sections, SOUL voice, blast-radius) and add placeholder/help text in the agent-editing UI. Lower priority; can land after 4.1–4.5.

## 5. Risks & Deferred (no open questions)

Both prior open questions are now decided: **OQ1 → hash-set refresh with static seeds (§4.2)**; **R4 → remove the dead `voice-profiles` branch now, defer a real setup-time voice step (§4.5)**.

- **R1 — personality prefix cost:** adding `<default-personality>` to every prompt adds tokens; it's budget-clipped like the other prefix sections (`token-budget.ts`). Keep the personality seed tight.
- **R2 — specialist over-proactivity:** P3 says *light*; the plan's per-template duty text must stay strictly in-lane so delegated sub-agents don't scope-creep. The devils-advocate lens must check each duty for scope creep.
- **R3 — existing materialized workspaces:** editing `agent-templates.ts` only affects NEW agent creation; agents already materialized (data/agents/*/IDENTITY.md) keep old text. Same as the Phase-1 `$X` note — a workspace backfill is out of scope unless requested.
- **Deferred to a later phase:** a real setup-time voice-tuning step (backend `voice-profiles` step + i18n'd frontend); the Phase-2 guidance-doc realignment (§4.6) if it doesn't fit; the Phase-1.5 prompt-cache (`cache_control`).

## 6. Verification Strategy

- Every surface change is TDD'd where it has logic (seed-migration hash-set, prefix personality section, resolveMasterSections personality); content-only changes get `contains/snapshot` tests (no placeholder ships; English default; a proactive duty present per agent; seed project prompt non-null; personality reaches the assembled prefix).
- A lifecycle regression test for §4.2: boot with an un-edited prior-version row → refreshed to current; boot with an owner-edited row → preserved.
- Full Vitest suite green + `tsc` clean before the phase gate; no version bump; per-task commits, nothing pushed without explicit request.
- The mandatory devils-advocate lens runs across the content (Enterprise-copy N/A for EYAS; focus on scope-creep in specialist duties, vendor-neutrality of all shipped text, and prompt-injection surface of any new instruction that tells agents to act).
