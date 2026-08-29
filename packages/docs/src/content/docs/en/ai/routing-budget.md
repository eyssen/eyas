---
title: Routing & budget
description: Auto-routing tiers, fallbacks, spending limits, and per-agent model assignments.
---

**What this is for.** Routing decides *which* model answers a turn. Budget decides *how much* you will spend before EYAS warns, downgrades, or hard-stops. Model assignments pin a default model on each built-in agent after setup. Together they keep a multi-provider instance from either always using the expensive model or silently running out of money.

**Route:** `/providers` → **Routing Tiers** and **Budget** tabs. Model assignments: Settings → **Model Assignments** card.

## When to use it

- Auto-routing should pick a cheap model for triage and a stronger one for code.
- A primary cloud/CLI is flaky and you want an explicit **Fallback** (or opt-in auto-failover).
- You need daily/weekly/monthly caps, a warn threshold, a downgrade, and a hard stop.
- Built-in agents still have no model after the wizard — assign them on Settings.

## Typical workflow

1. Open **Providers** (`/providers`) → **Routing Tiers**.
2. Toggle **Auto-routing** **On** if you want EYAS to select from message analysis (hint: *EYAS automatically selects the optimal model based on message analysis*).
3. For each tier set **Primary** provider+model and optional **Fallback**.
4. Open **Budget**: fill **Daily / Weekly / Monthly**, then **Warn at / Downgrade at / Hard stop at**.
5. Open **Settings** → **Model Assignments** to pin a model on each seed agent, then **Save assignments**.

## Features

### Cross-provider auto-failover (opt-in)

When **auto-failover** is enabled (`EYAS_AUTO_FAILOVER=1` or equivalent config), empty tier **Fallback** slots can be filled from a second live provider. **Already-set fallbacks are never overwritten.**

Use this for resilience when a primary cloud/CLI is flaky; still prefer explicit fallbacks you choose for cost/quality control.

Agent-level monthly token budgets are separate (agent Configuration).

## Fields and controls

<h2 id="auto-routing">Auto-routing</h2>

| Control | Meaning |
|---------|---------|
| **Auto-routing On/Off** | EYAS selects optimal model from message analysis when On |
| Hint | *EYAS automatically selects the optimal model based on message analysis* |

<h2 id="tiers">Routing tiers</h2>

Each tier has **Primary** provider+model and optional **Fallback**:

| Tier | Typical use |
|------|-------------|
| **Triage** | Classification / light routing |
| **Quick** | Fast cheap answers |
| **Standard** | Default quality |
| **Complex** | Hard tasks |
| **Code Execution** | Coding-heavy work |
| **Heartbeat** | Proactive/heartbeat loops (also used as a capture-model candidate when that provider is actually installed and is not a CLI) |
| **Embedding** | Vector embeddings |
| **Prompt Enhancer** | Prompt enhancer agent |

| Field | Meaning |
|-------|---------|
| **Select provider…** | Primary provider for tier |
| **Select model…** | Primary model |
| **Fallback / None** | Backup if primary fails |

<h2 id="budget">Budget / spending limits</h2>

| Field | Meaning |
|-------|---------|
| **Daily / Weekly / Monthly** | Caps for the period (`unlimited` if empty/0 policy) |
| **Warn at** | Warning threshold (% or absolute as UI shows) |
| **Downgrade at** | Switch to cheaper models |
| **Hard stop at** | Block further spend |

<h2 id="model-assignments">Model assignments (Settings)</h2>

Authenticated replacement for the wizard's optional AI-models step (that step is blocked once setup completes).

| Control | Meaning |
|---------|---------|
| Agent name | Built-in / seed agent |
| Model select | **— none —** or a model from enabled providers |
| **Save assignments** | PUT `/api/v1/model/agent-assignments` (`manage Model`) |

The card hides itself when there are no seed agents or no models yet.

## Related

- [Providers](/docs/en/ai/providers/)
- [Agents — token budget](/docs/en/agents/configure/)
- [Prompts](/docs/en/ai/prompts/)
- [Proactive](/docs/en/automation/proactive/)
