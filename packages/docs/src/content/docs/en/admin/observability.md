---
title: Observability & ops
description: Token telemetry, traces, cost, God Mode races, prompt-context cost and memory delivery per provider.
---

**What this is for.** Observability (`/observability`) is the telemetry surface for this instance: traces, cost, latency, anomalies, ensemble (God Mode) races, what the model actually received, and how evenly each provider received EYAS memory. **Ops** (`/ops`) is remediation. Hands, remote nodes, extensions, and notification preferences are **not** on this page — they have their own chapters.

| Area | Route | Meaning |
|------|-------|---------|
| Observability | `/observability` | Page **AI Observability** (sidebar **Observability**) — tabs **Usage**, **God Mode**, **Context** |
| Ops | `/ops` | Kubernetes ops agent — observe → diagnose → propose → approve → apply. Default **propose-only**. Cluster URL, kubeconfig, and GitOps repo are instance config, not product defaults. |

Elsewhere (not this page): [Hands](/docs/en/admin/hands/) (`/hands`), [Remote nodes](/docs/en/admin/nodes/) (`/nodes`) — including guarded SSH invoke, [Ingress](/docs/en/admin/ingress/) (`/ingress`), [Extensions](/docs/en/admin/extensions/) (`/extensions`), [Notifications](/docs/en/admin/notifications/) (`/notifications-settings`).

## When to use it

- You want to know what AI calls cost, per day and per model, and which of them were EYAS's own background work.
- A turn was slow, expensive or used tools, and you want its trace.
- You want to rate answers, or see how a God Mode race was decided.
- You want to see what actually went into the prompt, which sections were cut, and how far the token estimate drifts.
- You want to check that every provider — API models and CLIs alike — received the same memory.

## Typical workflow

1. Open **Observability** in the sidebar (`/observability`).
2. On **Usage**, narrow the trace table with **Model**, **From**, **To** and **Purpose**; rate a trace with the thumbs-up / thumbs-down buttons at the end of its row.
3. Open **God Mode** for ensemble races and win rates.
4. Open **Context** and start with **Memory delivery by provider**, then the section averages, truncation and estimate-vs-actual cards.

## Features

<h3 id="usage-tab">Usage tab</h3>

**Usage** is token telemetry: the **Total Traces**, **Total Cost**, **Avg Latency** and **Anomalies** cards, **Daily Cost**, **Model Distribution**, **Active Anomalies**, and the trace table — **Timestamp**, **Model**, **Provider**, **Purpose**, **Tokens**, **Cost**, **Latency**, **Tools**, **Quality** — with the filters **Model**, **From**, **To** and **Purpose** above it.

**Model and "answered by".** The **Model** column keeps the model id you chose, so labels and pricing stay stable. When the provider reported a different concrete model — a dated model version, a router's pick such as OpenRouter auto, the model loaded in Ollama or LM Studio, the model Grok actually ran — a second line shows *answered by &lt;model&gt;*. Background memory-capture runs are attributed to that concrete model too.

**Effort.** Every AI call's trace records the reasoning effort that was requested, the effort actually used after it was adjusted to the model, and where the request came from (conversation, Deep, colleague, delegating conversation, routing tier, model default, …). See [Providers — Reasoning effort](/docs/en/ai/providers/#reasoning-effort).

**Purpose.** A background model call — one EYAS makes for itself, not a conversation turn — shows its purpose group in the **Purpose** column:

| Label | Background calls |
|-------|------------------|
| **Memory** | Memory capture, nightly consolidation, the reflection briefing, Data Port import enrichment |
| **Learning** | The heartbeat, Self-learning, Forge, skill authoring |
| **Titles** | Auto-titles |
| **Safety checks** | Security judge, completeness critic, rubric planner |
| **Planning** | Team proposals, the between-phase re-planner |
| **Research** | Research runs |
| **Triage** | The Auto-routing classifier |

A conversation turn (a normal chat or agent turn) shows *—*, and so do traces from versions that did not record a purpose yet. The **Purpose** filter offers **All calls** (default) or one group; a group lists only its background calls (conversation turns never match), and changing the filter returns to the first page. Every background call is traced like a conversation turn — provider, model, tokens, cost, latency, requested and effective effort (source *routing tier*) — and its cost counts against the Routing budget's daily, weekly and monthly limits, as conversation turns do. A background call that could not run because no eligible model was available makes no model call, leaves no trace and costs nothing. Auto-title calls are attributed to their conversation. Where each group's calls go: [Routing & budget — Background model calls](/docs/en/ai/routing-budget/#background-model-calls-card).

**Tools.** The **Tools** column counts a trace's tool calls the same way on every provider: a call the model handed back for EYAS to run, and a call a CLI ran in its own loop — Claude Code, Grok CLI and Kimi Code CLI, whether it was the CLI's own built-in tool (shell, file read, …) or an EYAS tool it called over the EYAS bridge. Each call is counted once. Earlier versions showed 0 for every CLI turn.

**Quality.** The **Quality** column is your own rating: the thumbs-up / thumbs-down buttons at the end of a row mark the trace *good* or *bad*. EYAS does not score traces automatically; a number in this column comes from a trace recorded by an older version.

**Token counts mean the same on every provider.** *Input* tokens are the prompt tokens that were **not** served from the provider's cache; cached reads (and, on Anthropic, cache writes) are counted separately. Earlier versions counted the cached part inside input tokens for OpenAI-family and Gemini models, so their input numbers on cache-heavy conversations are smaller now and the cached part appears as cache reads. Reasoning or thinking tokens are part of *output* tokens; Gemini thinking tokens used to be missing, so Gemini output counts for thinking models are higher now. OpenAI reasoning tokens and Gemini thinking tokens are also stored on their own as reasoning tokens, for information only — they are not billed twice. Grok CLI and Kimi Code CLI counts follow the same meaning. If a provider sends no usage at all (some compatible servers, an Ollama server without counts, a CLI whose runtime reported nothing), the turn is marked *not reported* instead of being stored as a real zero; the conversation shows *Usage not reported* and the run tree *—* instead of $0. On the Anthropic API, prompt caching is automatic, so cache read and cache write tokens appear for those calls (see [Providers — Prompt caching](/docs/en/ai/providers/#prompt-caching-anthropic-api)).

**Cost.** When a provider reports a cost of its own, the trace uses it. Otherwise EYAS estimates it from the token counts, pricing every prompt token once: uncached input at the input rate, cache reads at the model's cache-read rate, cache writes at its cache-write rate. If the pricing table (or a `model.pricing` override in the config) has no cache rate for a model, its cached tokens are billed at the normal input rate. A call whose usage is *not reported* is never priced from token counts: its cost is the cost the provider itself reported, or $0. Compared with earlier versions:

- Kimi K3 through the Kimi API, and any model with a cache-read rate in a `model.pricing` override: estimates are lower, because the cached share is no longer counted twice.
- OpenAI and Gemini with the built-in table: input cost is unchanged.
- Gemini thinking models: estimates are higher, because thinking tokens are billed as output.
- Anthropic-compatible endpoints not in the table: cached tokens are billed at the conservative fallback input rate instead of free.
- Claude Code runs where the CLI reported no cost but did report token counts: cache tokens are priced at the matching Anthropic cache rates instead of free.

There is nothing to configure and nothing to migrate: new trace columns are added automatically.

**API (admins and integrators).** `GET /api/v1/observability/traces` (and `/traces/:id`) needs read access to the audit log (read `AuditEntry`). Each trace carries, besides the columns above:

- `purpose` (the exact purpose, for example `capture`, `title`, `security_judge`, `triage`), `auxRoute` (how the model was chosen: `tier` = the purpose's routing tier, `default` = the install default, `api` = an API provider, `isolated-cli` = a CLI that can run isolated) and `purposeGroup` — all three null for conversation turns;
- `toolCalls` — a JSON list of the calls, each `{name, id}`, plus `executedBy` (`provider` or `eyas`) for a call the CLI settled in its own loop;
- `memoryTiersUsed` — JSON counts of the memory recalled into that turn, per layer: `vt` vault note, `gs` gist (summary), `ft` fact, `en` entity, `ep` episode, `rw` raw record, for example `{"vt":75,"gs":5,"ft":3}`. It is null when the turn carried no memory, and for calls with no context composition (background calls).

The list accepts `purposeGroup=memory|learning|title|safety|planning|research|triage`. The query is validated: an unknown `purposeGroup`, a non-numeric or out-of-range `limit` (1–500), a negative `offset` or a non-numeric/negative `minCost` returns `400` instead of being ignored; empty parameters count as absent.

<h3 id="god-mode-tab">God Mode tab</h3>

The **God Mode** tab lists ensemble runs (conversation, winner, model count, cost, duration, whether a tie was broken), the win rate by model, and the average cost multiple versus a single model. Click a run to open that conversation's God tab (step log, who voted for whom, and each model's comments on the others).

How a race is set up, how the winner is chosen, and how to read the conversation God tab: [Conversations — God Mode](/docs/en/daily/conversations/#god-mode).

<h3 id="context-tab">Context tab</h3>

The **Context** tab shows what the model *actually* received, not what was meant to be sent. It opens with **Memory delivery by provider** (below), followed by:

- **Estimate vs. actual** — the gap between EYAS's token estimate and what the provider reported, with the mean absolute error;
- **Average tokens per section** — the average and peak token cost of each prompt section, and how many samples that rests on;
- **Truncation frequency** — how often, and which section, gets cut to fit the budget.

Detailed per-section records are short-lived by design (7 days by default, `observability.contextRetentionDays`); only the daily rollup survives long-term. If you go looking for older detail and can't find it, that's expected, not data loss.

<h4 id="memory-delivery-by-provider">Memory delivery by provider</h4>

This card shows, per provider, whether its turns received the same EYAS memory — the check that an API model and a CLI get memory equally. Pick the period in the top right: **Last 7 days**, **Last 30 days** or **Last 90 days**. There is one row per provider that answered turns in the period; after a failover, a turn counts for the provider that actually answered.

| Column | Meaning |
|--------|---------|
| **Provider** | The provider id. Click it to see its latest turns |
| **Turns with memory** | *N of M*: the turns whose message carried recalled memory, out of all its turns |
| **Items by layer (avg)** | The average number of injected memory items per layer, over the turns with memory, as layer-code badges (`vt`, `gs`, `ft`, `en`, `ep`, `rw`); hover a badge for the layer's name |
| **Memory tokens (avg)** | The average of the injected items' own token estimates, over the turns with memory |
| **Drill-downs per turn** | *X calls · Y items*, averaged over all turns: the `memory_search` / `memory_expand` calls the model made itself that read something, and the memory items those calls read |

Clicking a provider lists its latest 10 turns: the time (a link that opens the conversation), the model, the items per layer or *no memory*, the memory tokens, and the drill-downs (*calls · items*, or *items* only for turns recorded before call numbers were logged).

**How to compare providers.** Similar **Turns with memory** and **Items by layer (avg)** mean each model received the same memory. **Drill-downs per turn** show whether a model also opens memory itself: a CLI with far fewer drill-downs than the API models is not reaching, or not using, the EYAS memory tools.

The card is built from the context composition detail, so it only reaches back as far as `observability.contextRetentionDays` (7 days by default): **Last 30 days** and **Last 90 days** show more only when that retention is raised. A turn whose recall was not logged item by item counts as a turn, but with no items.

**API.** `GET /api/v1/observability/memory-parity?days=N` — `N` is an integer from 1 to 90 (default 7); it needs the same read `AuditEntry` permission as the other observability endpoints, and an invalid `days` returns `400`. The response is `{days, since, providers: [{provider, turns, memoryTurns, avgItemsByLayer, avgItems, avgMemoryTokens, drillDownTurns, avgDrillDownCalls, avgDrillDownReads, recentTurns: [{compositionId, createdAt, conversationId, model, hasMemory, itemsByLayer, items, memoryTokens, drillDownCalls, drillDownReads}]}]}`.

<h4 id="single-turn-composition">A single turn's composition</h4>

A single turn's composition opens from the conversation's context bar — see [Conversations — Context composition](/docs/en/daily/conversations/#context-composition): the measured or estimated window fill, the privacy badges per section, and the **Memory delivered** box. `GET /api/v1/observability/compositions/:id` returns the same: `composition.egress` and a per-section `egress` (`{masked, spans, skipped}`) for what the privacy layer did; `composition.delivery` (turnId, profile, budgetTotalTokens, recall — ids, hits, retrieved, expanded, chars, budgetChars, tokens, budgetTokens, withheld — and systemPromptChannel); and `composition.drillDown` (`{calls, reads, limit}`). Each is null when nothing was recorded; `drillDown` is also null when the memory access log cannot be read. The list endpoint is unchanged. In the memory access log, a turn's recall rows and drill-down rows share one turn id (the composition id), and drill-down rows record the call's number within the turn.

## Related

- [Mission Control](/docs/en/agents/runs/)
- [Routing & budget](/docs/en/ai/routing-budget/)
- [Memory](/docs/en/knowledge/memory/)
- [Multi-instance](/docs/en/deploy/multi-instance/)
- [Security](/docs/en/admin/security-privacy/)
- [Settings overview](/docs/en/admin/settings/)
- [Hands](/docs/en/admin/hands/)
- [Remote nodes](/docs/en/admin/nodes/)
- [Extensions](/docs/en/admin/extensions/)
- [Notifications](/docs/en/admin/notifications/)
