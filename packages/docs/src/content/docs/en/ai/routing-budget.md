---
title: Routing & budget
description: Routing tiers, auto-routing, fallbacks, spending limits.
---

**Route:** `/providers` → **Routing Tiers** and **Budget** tabs (also model assignments in Settings).

## Auto-routing

| Control | Meaning |
|---------|---------|
| **Auto-routing On/Off** | EYAS selects optimal model from message analysis when On |
| Hint | *EYAS automatically selects the optimal model based on message analysis* |

## Routing tiers

Each tier has **Primary** provider+model and optional **Fallback**:

| Tier | Typical use |
|------|-------------|
| **Triage** | Classification / light routing |
| **Quick** | Fast cheap answers |
| **Standard** | Default quality |
| **Complex** | Hard tasks |
| **Code Execution** | Coding-heavy work |
| **Heartbeat** | Proactive/heartbeat loops |
| **Embedding** | Vector embeddings |
| **Prompt Enhancer** | Prompt enhancer agent |

| Field | Meaning |
|-------|---------|
| **Select provider…** | Primary provider for tier |
| **Select model…** | Primary model |
| **Fallback / None** | Backup if primary fails |

## Budget / spending limits

| Field | Meaning |
|-------|---------|
| **Daily / Weekly / Monthly** | Caps for the period (`unlimited` if empty/0 policy) |
| **Warn at** | Warning threshold (% or absolute as UI shows) |
| **Downgrade at** | Switch to cheaper models |
| **Hard stop at** | Block further spend |

Agent-level monthly token budgets are separate (agent Configuration).

## Related

- [Providers](/docs/en/ai/providers/)
- [Agents — token budget](/docs/en/agents/configure/)
