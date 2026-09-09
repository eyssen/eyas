# EYAS Prompt System — Design Spec

**Date:** 2026-07-11
**Status:** Design approved (direction) — Phase 1 detailed, Phases 2–3 at design level
**Scope choice (user):** Full autonomy engine (wiring + authored content + model-in-the-loop self-improvement)
**Constraints:** Version freeze (no version bump), no auto-commit/push (explicit request only), vendor-neutral shipped defaults, root-cause fixes (no workarounds).

---

## 1. Context & Problem

The user asked to "properly write" three prompt surfaces so EYAS behaves as proactively, human-like, efficiently, and self-improvingly as possible:
1. the system's base prompts,
2. the base prompts of projects created at install,
3. the prompts of agents created at install.

A 6-way parallel source audit revealed that **the authored prompt text largely never reaches the model.** Two parallel prompt stacks exist; the well-designed one is dormant.

### Verified evidence (read on source, not memory)

- **Interactive chat gets an EMPTY system prompt.** `src/modules/conversations/routes.ts:334` calls `assembler.build(id)` and reads `assembled.system`, but `src/modules/prompt-wizard/assembler.ts` only exposes `buildForPrimary(opts)` returning `{prefix, suffix, reminders, ...}` — there is no `build` method and no `.system`. The call throws; an empty `catch {}` (routes.ts:336) swallows it; `system` stays `''`.
- **The runner already supports the v2 path; the callers were never switched.** `src/modules/agent/agent-runner.ts` accepts `systemPrompt?: AssembledPrompt` and flattens it (`flattenAssembledPrompt`, line 196). Its own comment: *"Task 29 will switch real callers to the v2 path."* **Task 29 was never completed.**
- **Background & team runs inject only the bare per-agent string.** `src/modules/agent/conversation-runner.ts:94` → `system: agent.systemPrompt`. `src/modules/agent/orchestrator.ts:622–645` → `system` = `agent.systemPrompt` + constraints. No platform identity, no mandatory/blast-radius rules, no voice.
- **Memory & team context are hardcoded off.** `src/modules/prompt-wizard/index.ts:144–145` → `resolveTeamContext: async () => null`, `resolveMemoryContext: async () => null`. The "persistent memory, don't ask what you already know" promise is structurally unfulfillable.
- **The human voice layer is fully built but disconnected.** SOUL presets + `VoiceProfile` + `resolveActiveVoiceAdapter` (index.ts:84) exist; `buildForPrimary` calls the voice resolver (assembler.ts:45) — but since `buildForPrimary` is never invoked by a live caller, no voice reaches inference.
- **Two divergent, duplicated sources of truth for identity + rules.** `master-prompt.ts` (`getMasterPrompt` → identity / coreRules / personality; DB-seeded "for frontend visibility", index.ts:158–179) vs `core-identity.ts` / `core-rules.ts` (autonomous-agent framing + blast-radius tiers). The two rule sets disagree.

### Collateral defects found
- `master-prompt.ts` coreRules #5 mandates **"Communicate in Hungarian"** — a vendor-neutrality regression (shipped default must be English/neutral).
- `system-engineer` template ships a literal unfilled placeholder **`$X/month`** to the model.
- Setup wizard branches on a `voice-profiles` step that **no module registers** (dead persona-voice step); `autoCompleteFromEnv` targets a renamed `first-agent` step (headless agent naming is dead).
- All 5 seed projects leave the `projects.prompt` column **NULL**; project-type prompts are one sentence.
- `code-reviewer` and `researcher` exist in **both** `config/agents/*.yaml` (crude v1 seed) and `agent-templates.ts` (richer v2) with divergent text (drift).
- Every specialist `IDENTITY.md` literally states **"Ongoing proactive duties: (none)"**; no persona references the self-learning / skill-evolution / forge loops.
- Proactivity/self-improvement loops are ~70% deterministic string templates; the real model-in-the-loop passes (`reflection-engine`, `semantic-promoter`) are OFF by default; `heartbeat.notify()` sends a canned alert where its own comment promises an LLM composer that does not exist.

**Conclusion:** authoring better prompt text is necessary but insufficient. The wiring must be restored first, or the text has no effect.

---

## 2. Goals & Non-Goals

### Goals
- G1. Every runtime path (interactive chat · background/autonomous · team · delegated sub-agent) receives a **complete, canonical system prompt** (identity + rules + personality/voice + workspace + project cascade + memory/team/runtime).
- G2. **One** canonical source of truth for platform identity/rules/personality — no dual stack, no drift.
- G3. That canonical source is **DB-seeded from code and fully UI-editable**, with reset-to-default (per user decision).
- G4. Shipped default voice is **vendor-neutral English, "distinctive but warm"** — a real colleague, not a bland bot; Hungarian/`tegező` and named presets are options, not defaults.
- G5. Authored prompt content across base + seed agents + seed projects + setup copy drives **proactive, human-like, efficient, self-improving** behavior.
- G6. Proactivity/self-improvement loops become **genuinely model-in-the-loop** where they are currently canned — **OFF by default** with a strong onboarding nudge and one-click enable.

### Non-Goals
- No version bump; no commit/push unless explicitly requested.
- No new external service dependencies (Architecture Rule 1).
- Not rebuilding the model gateway, CASL, audit, or security-gate — hard enforcement stays code-side (see §4.3).
- Not coupling any default to eyssen.com / Odoo / a specific vendor.

---

## 3. Decisions (from clarification)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Overall scope | **Full autonomy engine** (wiring + content + engine loops) |
| D2 | Canonical source & editability | **Fully DB-seeded + UI-editable**; code = fallback seed; runtime assembles from the DB store; reset-to-default per section |
| D3 | Shipped default voice / language | **English, "distinctive but warm"**; Hungarian/`tegező` + presets are options; delete the `LANGUAGE: Hungarian` mandatory rule |
| D4 | Autonomy loops default posture | **OFF by default** + strong onboarding nudge + one-click enable; genuinely good when ON |
| D5 | Build shape | **Phased**, one design doc for the full vision; Phase 1 implementation-ready; Phases 2–3 get their own writing-plans plan at their gate |

---

## 4. Target Architecture

### 4.1 One canonical layered prompt, reaching all paths

The `AssembledPrompt` produced by `assembler.buildForPrimary(opts)` becomes the **single** system-prompt path. All four callers build it and pass it as `systemPrompt` (the runner already flattens it):

```
<core-identity>        ← canonical, DB-seeded, editable   (platform + autonomous operating model)
<core-rules>           ← canonical, DB-seeded, editable   (merged mandatory rules + blast-radius)
<default-personality>  ← canonical, DB-seeded, editable   (warm-EN global default; NEW in prefix)
<project-context>      ← project-type + project cascade   (incl. project operating brief, Phase 2)
<agent-identity>       ← per-agent IDENTITY.md (workspace)
<agent-voice>          ← per-agent SOUL.md / VoiceProfile  (overrides/augments default personality)
<agent-notes>/<env>    ← AGENTS.md / TOOLS.md
<available-skills>/<available-tools>
--- cache boundary ---
<team-context>         ← resolveTeamContext (WIRED, was null)
<working-memory>       ← resolveMemoryContext (WIRED, was null)
<runtime>              ← date/time/channel/os
<active-voice>         ← resolved voice scope
```

Prefix is cacheable (stable across turns → `cache_control`); suffix is volatile.

### 4.2 DB-seeded, UI-editable canonical text

- Code holds the **seed constants** (the authored default text).
- On first boot, seed the master-level sections (`identity`, `core-rules`, `personality`) into the existing `prompt_templates` table (`level='master'`), plus SOUL presets and per-agent workspace files. (Seeding already happens for the three master sections — index.ts:167–179; extend so the assembler *reads* them.)
- `buildForPrimary` resolves `coreIdentity` / `coreRules` / `personality` from the **DB store** (not the code constants directly), falling back to the seed if a row is missing.
- UI edits to those rows take effect on the next assembled prompt. Add **reset-to-default** (re-seed a section from code) in the prompt-settings UI.
- Project-type / project / conversation level rows continue to layer on top via the existing inheritance model (`section-merger` / `prompt-builder`), except LOCKED sections which projects cannot override (identity/coreRules remain owner-only, but still owner-editable at master level).

### 4.3 Editable rules are advisory; enforcement stays code-side (safety reconciliation)

Making the mandatory-rules **text** fully editable is safe because the prompt rules are **model guidance**, not the enforcement mechanism. Hard enforcement remains in code and is unaffected by prompt edits:
- CASL permission checks on protected endpoints,
- audit logging of every AI action,
- `security-gate` autonomy-approval queue + blast-radius gates,
- destructive-tool confirmation.

The spec records this explicitly so "fully editable" (D2) is not read as "disable safety." The prompt-settings UI shows a soft warning when editing the `core-rules` section, noting that enforcement is code-side and edits only change what the model is told.

### 4.4 Canonical identity / rules consolidation (Phase 1 content = merge, not rewrite)

Phase 1 merges the two existing sets into one canonical set (keeping the stronger of each; deleting the Hungarian-language rule). Deep re-authoring for voice/proactivity is Phase 2.

**Canonical identity** = platform framing (from `master-prompt.identity`: dedicated single-user self-hosted assistant, persistent memory, project/task awareness, autonomous execution, delegation, knowledge base) **+** autonomous operating model (from `CORE_IDENTITY`: not a passive chatbot; IDENTITY.md/SOUL.md/MEMORY.md are continuity; tools to schedule/heartbeat/initiate; act externally only when mission-aligned; ask the owner rather than drift).

**Canonical core-rules** (merged, vendor-neutral):
1. AUDIT — every action logged; never hide/obscure.
2. PERMISSIONS — respect CASL; never escalate.
3. BLAST RADIUS — LOW execute freely / MEDIUM if task implies / HIGH explicit confirmation / CRITICAL typed confirmation. *(replaces master's weaker "SAFETY")*
4. SECRETS & PRIVACY — never expose or log secrets; don't exfiltrate private data.
5. HONESTY / NO HALLUCINATION — if unknown/unverified, say so; never fabricate APIs/paths/data.
6. SCOPE — act only within assigned tools; report gaps, don't improvise.
7. VERIFICATION — verify before acting; check existing code/data first; search before claiming absence.
8. MEMORY — use persistent memory proactively; update it when you learn something.
9. COST — be token-efficient; prefer diffs over full rewrites; don't pull more context than needed.
10. SECURITY — refuse destructive techniques, mass targeting, supply-chain compromise, malicious evasion.
11. AI DISCLOSURE — disclose AI involvement on external messages when asked or contextually appropriate.
12. INTEGRATION TESTS — use real services where the user directed integration testing.
13. ASK BEFORE COMMIT — never auto-commit/push/modify shared state without explicit owner approval.
14. LANGUAGE — match the user's language; code, comments, commit messages, and identifiers always in English. *(replaces "Communicate in Hungarian")*

---

## 5. Phase 1 — Foundation: wiring & consolidation (implementation-ready)

**Objective:** the authored text actually reaches the model on every path, from one canonical DB-seeded/editable source, with memory + voice connected. **No behavioral re-authoring yet** beyond the merge above and defect fixes.

### 5.1 Work items

1. **Complete Task 29 — route all callers through the assembler.**
   - `conversations/routes.ts:328–340`: replace the broken `assembler.build(id)` with `assembler.buildForPrimary({ agentId, agentName, conversationId, projectId, channelContext })` and pass the returned `AssembledPrompt` to the runner as `systemPrompt` (not the flattened string), so prompt-cache boundaries survive. Keep `body.system` override precedence. Resolve `agentId`/`projectId` from the conversation.
   - `conversation-runner.ts:94`: build an `AssembledPrompt` via the assembler for the conversation's agent and pass `systemPrompt`; keep `agent.systemPrompt` as the per-agent identity layer (it already seeds the workspace IDENTITY.md), not as the whole system prompt.
   - `orchestrator.ts:622–645`: same — delegated/team agents get identity + rules + voice + constraints, assembled, not the bare string. Wire `subagent-prompt-builder`'s delegated-voice so sub-agents inherit the parent voice snapshot (or explicitly drop it if we choose not to).
   - Note: `buildForPrimary` is **agent-generic** despite its name (it builds a full prompt for any `agentId`). Planning decides whether to reuse it for background/team/delegated agents as-is or rename it (e.g. `buildForAgent`) to avoid confusion.
2. **Make the assembler DB-backed** (D2): resolve `coreIdentity`/`coreRules`/`personality` from `prompt_templates` (level `master`), fall back to seed constants; add a `<default-personality>` section to `buildCachePrefix`.
3. **Wire the null resolvers** (index.ts:144–145): `resolveMemoryContext` → memory module's context builder (`context-builder-v2`); `resolveTeamContext` → team-session service. Respect token budgets already in `cache-suffix-builder`.
4. **Consolidate the dual stack** (G2): pick `core-identity.ts` + `core-rules.ts` (blast-radius) as the canonical seed; fold in the useful master-prompt identity/personality content; retire `getMasterPrompt`'s duplicate role (or repoint the DB seed to the merged constants). One seed → one DB row set → one runtime read.
5. **Fix collateral defects that reach the model now:** remove `$X/month` placeholder; delete the Hungarian-language rule (→ rule 14 above); resolve `code-reviewer`/`researcher` drift (single source; retire or align the `config/agents/*.yaml` duplicates).
6. **Prompt-cache live:** confirm the registered Anthropic provider applies `cache_control` to the prefix (the v2 `adapter.ts` design) or bridge the flattened path so the stable prefix is cached.

### 5.2 Acceptance criteria (Phase 1 gate)
- A test proves the assembled `system` (or `systemPrompt.prefix`) is **non-empty and contains the canonical identity + core-rules** for each path: interactive chat, background conversation, team-delegated agent.
- A test proves `resolveMemoryContext`/`resolveTeamContext` return real data when available (no longer always null).
- A test proves editing a master `prompt_templates` row changes the assembled prompt (UI-editability is real).
- No `$X`, no "Communicate in Hungarian", no duplicate `code-reviewer`/`researcher` rows in seeds.
- Full suite green; typecheck clean (root + web); no version bump.

---

## 6. Phase 2 — Authored content (the core of the original ask)

**Objective:** write the actual proactive / human-like / efficient / self-improving text now that it reaches the model. Gets its own writing-plans plan at the Phase-2 gate. *This is where the user co-authors the base personality voice (Learning-mode contribution point).*

Targets (from the audit's rewrite list):
- **Base identity / core-rules / personality text** — final "distinctive but warm" English voice; explicit trigger→action **proactivity** spec (surface overdue/stalled/at-risk work, propose the next concrete step) and an explicit **self-improvement** clause (at task end reflect on what worked; when a tool/skill underperforms, record friction / propose an improvement). *(`prompt-wizard/master-prompt.ts` seed + `core-identity.ts`/`core-rules.ts`.)*
- **Seed agents** — kill the identical robotic checklist skeleton; give each specialist a real domain-scoped proactive duty (replace "Ongoing proactive duties: (none)") and lean on SOUL voice for the human "vibe" instead of a single one-liner; fold the dead v1 `systemPrompt`/role/goal/backstory fields' useful content into the shipped path or remove them. *(`agent/agent-templates.ts`, `config/agents/*.yaml`.)*
- **Seed projects** — give the default project(s) a genuine operating brief in `projects.prompt` (currently NULL) and richer project-type prompts, so agents inherit real per-project context. *(`board/index.ts` seed.)*
- **Setup wizard copy** — WHY-driven onboarding that frames agents as proactive teammates (with examples); fix/retire the dead `voice-profiles` step so users can humanize voice at install; fix `autoCompleteFromEnv` (`first-agent` → `primary-agents`, both names); i18n the English-only + hardcoded-Hungarian wizard copy; de-duplicate the hardcoded team-agents list (fetch from the template source).
- **Prompt-guidance docs & inline help** — realign `config/skills/ai/prompting/*` and `agent-personas.md` to EYAS's actual structures (IDENTITY.md sections, SOUL voice, blast-radius) and add placeholder/help text in the agent-editing UI. *(Lower priority; can trail Phase 2.)*

---

## 7. Phase 3 — Autonomy engine: model-in-the-loop (OFF by default)

**Objective:** make proactivity/self-improvement genuinely reasoned, not string-concatenated. All OFF by default (D4) with a strong onboarding nudge + one-click enable; fail-open; cheap-tier + 0-token activity gate preserved. Own writing-plans plan at the Phase-3 gate.

- **Heartbeat LLM composer** — replace `proactive-assistant/heartbeat.ts` `notify()`'s canned alert with the cheap-tier composer prompt its own comment already promises: turn detected signals into a real, human-voiced message. Keep the existing 0-token gate (only spend when there is real activity).
- **Forge LLM proposal pass** — `forge/proposal-engine.ts` `proposedValue` is literal string concat; replace with a cheap-tier pass that reads the current description + top frictions and authors an actual improved description. Populate the currently-empty `betterApproach`/`topSuggestions` input (a reflection sub-pass or an agent-called "report friction" path).
- **Reflection enrichment** — enrich `memory/reflection-engine.ts` (today three flat lists, OFF) to emit actionable, structured learnings that feed forge/self-learning (tool/skill/prompt improvement candidates).
- **Prompt-side triggers** — the canonical identity/personality (Phase 2) tells agents *when* to reflect, record friction, call `forge_propose_soul_change`, or `propose_agent_creation` — so the existing tools are actually exercised.
- **Self-learning** — optionally let `self-learning/execution-learner.ts` convert each metric anomaly into a concrete agent-specific prompt/constraint edit via a small LLM pass (proposal, human-review-gated).

---

## 8. Risks & Open Questions

- **R1 — Prompt-cache correctness.** Passing `systemPrompt: AssembledPrompt` must reach a provider that honors `cache_control`; the live v1 Anthropic provider currently sends a single string. Confirm during Phase-1 planning whether to activate the v2 adapter or add cache_control to the v1 path. *(Efficiency goal depends on this.)*
- **R2 — Memory context cost/size.** Wiring `resolveMemoryContext` adds tokens to every prompt; rely on the existing `token-budget` clipping and keep memory in the volatile suffix (already the design).
- **R3 — Delegated voice.** Decide in Phase 1 whether sub-agents inherit the parent's voice snapshot (`subagent-prompt-builder`) or use their own SOUL — either is fine, but pick one and wire it (today it is silently dropped).
- **R4 — `config/agents/*.yaml` fate.** Retire them in favor of `agent-templates.ts`, or keep as documented fallback seeds? Recommendation: keep as fallback seeds but generate/align from the template source to kill drift. Confirm in Phase 2.
- **OQ1 — Onboarding nudge surface.** Where does the "turn on proactivity" nudge live (setup wizard step vs. post-setup dashboard card)? Decide at Phase 3.

---

## 9. Verification Strategy

- Every phase: full Vitest suite green + root/web typecheck clean before its gate; no version bump; nothing committed without explicit request.
- Phase 1: new tests asserting non-empty canonical system prompt per path + memory/team wiring + UI-editability round-trip (edit DB row → assembled prompt changes).
- Phase 2: snapshot/contains tests for the shipped seed text (no placeholders, English default, proactive-duty present per agent, seed project prompt non-null).
- Phase 3: tests that loops are OFF by default, fail-open, and (when enabled with a stub model) produce a composed/reflected artifact rather than a static string.
- Phase gates are interactive: stop and get user approval at each phase boundary (scope/spec → plan → 🔴 critical finding → after tests → before commit).
