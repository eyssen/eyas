---
title: Routing & budget
description: Auto-routing tiers, fallbacks, background model calls, spending limits, and per-agent model assignments.
---

**What this is for.** Routing decides *which* model answers — the model a new conversation is fixed to, the tiers a conversation set to Auto is routed across, and the model EYAS's background work runs on. Budget decides *how much* you will spend before EYAS warns, downgrades, or hard-stops. Model assignments pin a default model on each built-in agent after setup. Together they keep a multi-provider instance from either always using the expensive model or silently running out of money.

**Route:** `/providers` (sidebar **Providers**) → **Routing Tiers** and **Budget** tabs. Model assignments: Settings (`/settings`) → **Model Assignments** card.

## When to use it

- Conversations set to Auto should get a cheap model for quick questions and a stronger one for code.
- Background work — titles, the heartbeat, the security judge, memory capture — should run on a model you choose (the **Heartbeat** tier).
- A primary cloud/CLI is flaky and you want an explicit **Fallback** (or opt-in auto-failover).
- You need daily/weekly/monthly caps, a warn threshold, a downgrade, and a hard stop.
- Built-in agents still have no model after the wizard — assign them on Settings.

## Typical workflow

1. Open **Providers** (`/providers`) → **Routing Tiers**.
2. Check the **Background model calls** card at the top: each group of background work should show a model, not *No model — deterministic fallback*.
3. Switch **Allow Auto-routing** **On** if conversations set to Auto may be routed by message analysis (hint: *When on, a conversation set to Auto-routing picks its model per message. Conversations with a fixed model or a colleague default are never re-routed.*).
4. For each tier set the **Primary** provider and model, an optional **Fallback**, and the tier's default **Effort**.
5. Open **Budget**: fill **Daily / Weekly / Monthly** under **Spending Limits**, then **Warn at / Downgrade at / Hard stop at** under **Thresholds**.
6. Open **Settings** → **Model Assignments** to pin a provider and model on each seed agent, then **Save assignments**.

## Features

<h3 id="auto-failover">Cross-provider auto-failover (opt-in)</h3>

When **auto-failover** is enabled (`EYAS_AUTO_FAILOVER=1`, or `model.autoFailover: true` in the config), empty tier **Fallback** slots are filled at start from a second live provider. **Fallbacks you set are never overwritten.**

Use this for resilience when a primary cloud/CLI is flaky; still prefer explicit fallbacks you choose for cost/quality control.

Agent-level monthly token budgets are separate (agent **Configuration**).

<h3 id="default-binding">Which model answers when nothing names one</h3>

Some EYAS calls name no provider or model: a new conversation's first message (the conversation then keeps that model — see [Conversations — Which model answers](/docs/en/daily/conversations/#which-model-answers)), design AI edits, and agent runs whose agent has no model. They go to the **install default**, checked in this order:

1. the **Standard** routing tier, if its provider is enabled;
2. otherwise the install's default provider and model — set when you choose the **Primary CLI** in the [setup wizard](/docs/en/setup-wizard/), or with `PUT /api/v1/model/defaults`;
3. otherwise the enabled provider that comes first alphabetically and has at least one enabled model.

No provider is preferred by name, and the order in which providers start does not matter. If none of these exists, the call fails with *No default model binding: configure the Standard tier or a default provider* instead of guessing. Earlier versions sent such calls to Anthropic if it was configured, otherwise to whichever provider happened to register first — so on a multi-provider install without a Standard tier these calls may now go to a different provider than before. Setting the Standard tier (or the default provider) controls it.

<h3 id="background-model">The background model</h3>

EYAS's background work never runs on a provider the gateway happens to pick. It goes through one resolver that tries fixed candidates in order and uses only a model that can run an **isolated** call — no tools, one turn, none of the CLI's own memory or config. Eligible are every API provider, Claude Code, and Grok CLI / Kimi Code CLI once EYAS has verified their isolation on this host. A CLI that cannot isolate is never used, neither as a candidate nor as a tier's **Fallback**.

| Background work | Candidates, in order |
|-----------------|----------------------|
| Conversation titles | **Heartbeat** tier only — never the conversation's own model or any other provider |
| Memory capture, nightly consolidation, the reflection briefing, the heartbeat briefing, Self-learning suggestions, Forge proposals, skill authoring, Data port enrichment | **Heartbeat** tier (primary, then fallback) → install default → API providers alphabetically → CLIs that can run isolated |
| Security judge, completeness critic, rubric plan for complex background goals | **Heartbeat** → **Quick** → install default → other eligible providers |
| Team proposal and the between-phase re-planner | **Quick** → **Standard** → install default → other eligible providers |
| Research (query expansion, source scoring, writing, cross-check) | **Standard** → install default → API providers → CLIs that can run isolated |
| Auto-routing classifier | **Triage** tier only (primary, then fallback) — see [Auto-routing](#auto-routing) |

A second candidate is tried only after a network, timeout, overload or rate-limit failure, never after the first one has answered (in practice only the safety group tries one). A budget **stop** means no call at all.

<h4 id="background-effort">Effort of background calls</h4>

Each background call asks for the reasoning effort set on the first routing tier of its purpose: the **Heartbeat** tier for memory work, learning work, titles and the safety checks; **Quick** for re-planning and team proposals; **Standard** for research; **Triage** for the Auto-routing classifier. The same tier effort applies whichever model ends up answering — the tier's own model, the install default, an API provider or a CLI that can run isolated — and it is fitted to that model: an unsupported level moves to the nearest one it accepts. Triage, Quick and Heartbeat default to *Low*, so by default most background calls ask for Low; research follows Standard, which defaults to Auto. A tier set to Auto sends no effort parameter. When the model has no effort control, or EYAS cannot tell which model answers (a CLI called without a specific model, common on CLI-only installs), nothing is sent and the model's own default applies.

<h4 id="background-traced">Traced and counted</h4>

Every background call is traced like a conversation turn — provider, model, tokens, cost, latency, its purpose, the requested and effective effort — and its cost counts against the budget's daily, weekly and monthly limits, the same way conversation turns do. A background call that could not run because no eligible model was available makes no model call: it leaves no trace and costs nothing. See [Observability — Usage](/docs/en/admin/observability/#usage-tab).

Every background call sends its instructions as a real system prompt and exactly one user message, on every provider — never as a user or assistant line.

<h4 id="background-no-model">When no model qualifies</h4>

For example on a Grok-only or Kimi-only install before their isolation is verified, EYAS makes no model call and each feature keeps its deterministic result: the first-message snippet stays the title; the heartbeat sends the alert *Heartbeat: items may need your attention* with its list of reasons; Self-learning shows its generic suggestions; Forge keeps the concatenated proposal; Skill Evolution writes the template `SKILL.md`; memory capture records a skip; consolidation leaves clusters for a later night; the briefing keeps its deterministic part; the security judge escalates to your approval; the critic marks the run *Unverified*; the team proposal is a single agent; research assembles its report from the top sources. On an install where Claude Code is the only model, each such call starts one short isolated Claude Code process.

<h3 id="background-model-calls-card">Background model calls card</h3>

The **Routing Tiers** tab opens with a **Background model calls** card. It shows where EYAS's background work goes right now, without making any model call. There is one row per group:

| Group | What it covers |
|-------|----------------|
| **Memory: capture, consolidation, reflection, import enrichment** | Capture, nightly consolidation, the reflection briefing, Data Port import enrichment |
| **Learning: heartbeat, self-learning, Forge, skill authoring** | The heartbeat, Self-learning, Forge, skill authoring |
| **Conversation titles** | Auto-titles |
| **Safety: security judge, completeness critic, goal rubric** | Security judge, completeness critic, goal rubric |
| **Planning: team proposal, re-planner** | Team proposal, the between-phase re-planner |
| **Research** | Research runs |
| **Auto-routing triage** | The Auto-routing classifier |

Each row shows either the provider and model the group's next call would use, as *Provider · Model*, with a badge naming where it came from — **Tier** (the group's routing tier, primary then fallback), **Default** (the install default), **API provider**, or **Isolated CLI** (a CLI that can run isolated calls; it shows only its provider name, because it runs its own default model) — or **No model — deterministic fallback**, with the reason:

- *No provider can run an isolated call* — nothing eligible is enabled, for example a Grok-only or Kimi-only install before EYAS has verified their isolation, or a tier that names such a CLI;
- *Its tier is not configured* — only for titles and triage, which use their tier only;
- *Budget limit reached* — a budget stop blocks every background call.

The card shows the first candidate. When any group has no eligible provider, a red banner says that some background work has no model it may use, so it runs its built-in fallback and makes no model call, and asks you to enable an API provider or a CLI whose isolation EYAS has verified. A missing tier or a budget stop shows its reason on the row but no banner. The card refreshes whenever you open the Routing Tiers tab and after every tier change on that tab.

**API (integrators).** `GET /api/v1/routing/auxiliary` (read Settings; `401` when not signed in, `403` without the permission) returns `{ groups: [ { group, purposes, target: { provider, model | null, route } | null, reason | null } ] }` — `group` is `memory`, `learning`, `title`, `safety`, `planning`, `research` or `triage`; `route` is `tier`, `default`, `api` or `isolated-cli`; `reason` is `no_eligible_provider`, `tier_not_configured` or `budget_stop`. It answers `503` only if the background-model service is unavailable. Background calls are labelled with their purpose in [Observability](/docs/en/admin/observability/) traces.

## Fields and controls

<h2 id="auto-routing">Auto-routing</h2>

| Control | Meaning |
|---------|---------|
| **Allow Auto-routing** On/Off | Allows Auto-routing for conversations set to Auto. It does not route other conversations |
| Hint | *When on, a conversation set to Auto-routing picks its model per message. Conversations with a fixed model or a colleague default are never re-routed.* |

**Only conversations set to Auto are routed.** A conversation keeps the model it runs on: a fixed model, or its colleague's model, is never triaged. A conversation set to Auto has its message classified and routed to the **Quick**, **Standard**, **Complex** or **Code Execution** tier. While the switch is off, an Auto conversation uses its stored model and says so. When every tier points at the same model (for example a single-CLI install), no classification is made at all. You choose Auto-routing per conversation in the model picker in its top bar; the entry is greyed out while **Allow Auto-routing** is off. See [Conversations — Which model answers](/docs/en/daily/conversations/#which-model-answers).

**The classifier.** Keyword rules come first and cost nothing: a message they place (for example a translation, a code review or a debugging request) makes no model call. Only a message they cannot place is sent to the model on the **Triage** tier — its Primary, or its Fallback when the Primary cannot be used, and only when that provider can run isolated calls. It never falls back to the Standard tier, the install default or any other provider. The call is isolated (no tools, no provider memory or config, no session kept), sends only the first 500 characters of the message, goes through the same privacy masking and tracing as every other model call, and counts toward the spending limits. If no such model exists, the budget's hard stop has been reached, or the answer is not a valid category and complexity, the keyword classification decides and the turn is not delayed. On a Claude Code-only install, an unmatched message in an Auto conversation still waits for one short isolated Claude Code call before the answer starts.

<h2 id="tiers">Routing tiers</h2>

Each tier has a **Primary** provider and model and an optional **Fallback**:

| Tier | Typical use |
|------|-------------|
| **Triage** | The Auto-routing classifier for messages the keyword rules cannot place (primary and fallback only) |
| **Quick** | Fast cheap answers |
| **Standard** | Default quality — also the install default for calls that name no model ([above](#default-binding)) |
| **Complex** | Hard tasks |
| **Code Execution** | Coding-heavy work |
| **Heartbeat** | First choice for EYAS's background work — titles (the only candidate), the heartbeat, memory capture, the security judge and more ([above](#background-model)) |
| **Embedding** | Feeds only the older vault and episodic search index. Memory recall never uses it: recall always embeds locally (see [Memory — Vector search always runs locally](/docs/en/knowledge/memory/#vector-search-always-runs-locally)). If the tier names a provider that cannot embed, that index uses the local embedder too; when its embedder changes, the index is emptied once and rebuilt automatically |
| **Prompt Enhancer** | The Prompt Enhancer in the conversation composer and the Prompt coach on projects and agents ([Prompts](/docs/en/ai/prompts/)) |

| Field | Meaning |
|-------|---------|
| **Select provider…** | Primary provider for the tier |
| **Select model…** | Primary model |
| **Fallback** (**Select fallback…** / **None**) | Backup if the primary fails |
| **Effort** | The tier's default reasoning effort (every tier except **Embedding**) — see [below](#tier-effort) |

On a Kimi Code CLI install, tiers that EYAS itself had set to the retired rows *Kimi Code CLI (K3)*, *(K2.7 Code)* or *(K2.6)* are moved at start to **Kimi Code CLI** (the default row), which is what they always ran; a new Kimi-only install starts every tier on it, with no fallback. See [Providers — Kimi models and thinking](/docs/en/ai/providers/#kimi-models-and-thinking).

<h3 id="tier-effort">Tier default effort</h3>

Each routing tier except **Embedding** has an **Effort** select: the default reasoning effort for calls routed to that tier. **Triage**, **Quick** and **Heartbeat** default to *Low*; every other tier to *Auto* (the model's own default). The select lists only the levels the tier's model accepts; picking a model that does not offer the saved level changes it before saving and says so (*Effort adjusted from … to …*), and a level the model does not accept is refused with *The model does not offer this effort level. Nothing was saved.*

The tier default applies in two places:

- **A message routed through the tier**, when nothing higher in the order sets a level: conversation's own level > Deep (Max) > colleague > delegating conversation > routing tier > model default.
- **EYAS's background calls** whose first tier it is — Heartbeat for memory, learning, titles and the safety checks; Quick for re-planning and team proposals; Standard for research; Triage for the classifier ([above](#background-effort)).

So changing a tier's effort changes both that tier's routed messages and the background calls that use it. Existing installs got the *Low* default once, on the first start after the upgrade; a tier you later set back to Auto stays Auto. `PUT /api/v1/routing/tiers/:tier` validates its body: an unknown tier returns `404`, and an effort the tier's model does not accept returns `400` with code `EFFORT_UNSUPPORTED` and the accepted levels. See [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort).

<h2 id="budget">Budget / spending limits</h2>

| Field | Meaning |
|-------|---------|
| **Daily / Weekly / Monthly** (**Spending Limits**) | Dollar caps for the period; empty means *unlimited* |
| **Warn at** (**Thresholds**) | Warning threshold, as a fraction of the cap (shown as a percentage; default 0.8 = 80%) |
| **Downgrade at** | Switch to cheaper models (default 1.0 = 100%) |
| **Hard stop at** | Block further spend, background calls included (default 1.2 = 120%) |

<h2 id="model-assignments">Model assignments (Settings)</h2>

The authenticated replacement for the wizard's optional AI-models step (that step is blocked once setup completes).

| Control | Meaning |
|---------|---------|
| Agent name | Built-in / seed agent |
| Model select | **— none —** or a model from enabled providers, shown as *Provider / model* |
| **Save assignments** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

Saving stores the provider and the model together, so a model id that two providers list is never ambiguous. The API takes `{assignments: {agentId: {providerId, modelId}}}` or the older `{agentId: modelId}`; a model id listed by several providers is then stored without a provider. If any model is not in the catalog, it returns `400` with `code: unknown_model` and the `agents`, and nothing is written.

The card hides itself when there are no seed agents or no models yet.

## Related

- [Providers](/docs/en/ai/providers/)
- [Observability](/docs/en/admin/observability/)
- [Agents — token budget](/docs/en/agents/configure/)
- [Prompts](/docs/en/ai/prompts/)
- [Proactive](/docs/en/automation/proactive/)
