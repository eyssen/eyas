---
title: Self-learning & skill evolution
description: Usage insights, skill suggestions, and human-reviewed skill candidates.
---

**What this is for.** Two operator surfaces sit behind this chapter. **Self-Learning Insights** (`/self-learning`) reports how runs are spending tokens and what patterns keep showing up. **Skill Evolution** (`/skill-evolution`) is the human gate for AI-suggested new skills. Neither writes behaviour until you approve. Enable the related autonomy loops only if you want background proposals — they make paid model calls.

**Routes:** `/self-learning` (sidebar **Self-learning**), `/skill-evolution`.

## When to use it

- You want a weekly efficiency picture: tokens, cost, sessions, success rate.
- Repeated work looks like it should become a skill, and you want the suggestion — not a silent auto-write.
- Skill Evolution has pending candidates and you need to **Approve** or **Reject** them.
- You already use [Forge](/docs/en/agents/forge/) for identity/soul changes and want the skill-side equivalent.

## Typical workflow

1. Open **Self-learning** (`/self-learning`). Read the four summary cards, then **Execution Insights**, **Activity Patterns**, and **Skill Suggestions**.
2. Press **Run Analysis** when you want a fresh pass (`POST /self-learning/analyze`).
3. Open **Skill Evolution** (`/skill-evolution`) for candidates with **Pending / Approved / Rejected**.
4. Expand **Show details**, read reasoning and suggested content, then **Approve** (adopts into the catalogue, still subject to the [auto-adoption gate](/docs/en/automation/skills/)) or **Reject**.
5. Confirm the new skill under [Skills](/docs/en/automation/skills/) → **Inventory**.

## Features

| Area | Meaning |
|------|---------|
| Insights | Patterns learned from usage |
| Skill suggestions | Names + reasons from the insights page — not yet candidates |
| Skill evolution | Proposed skill files with content, confidence, and session count |
| Review / apply | Human gate before behaviour changes |

Prefer reviewing Forge/skill proposals before apply. Generated skills still pass the Skills auto-adoption gate.

## Fields and controls

<h2 id="insights">Self-Learning Insights (`/self-learning`)</h2>

Subtitle: *Efficiency reports, activity patterns, and optimization suggestions.*

| Control | Meaning |
|---------|---------|
| **Run Analysis** | Trigger a fresh analysis pass |
| **Total Tokens** | Tokens in the weekly report |
| **Total Cost** | USD in the weekly report |
| **Sessions** | Session count |
| **Success Rate** | Share of successful sessions |

**Execution Insights** — type badges **Optimization / Cost / Quality / Speed**, plus current vs suggested metric, confidence, and reasoning. Empty: *No insights yet. Run an analysis to generate them.*

**Activity Patterns** — name, category, seen N×, last seen. Empty: *No activity patterns detected yet.*

**Skill Suggestions** — name, description, reason, confidence. Empty: *No skill suggestions yet.* These are suggestions; they become reviewable candidates on Skill Evolution.

<h2 id="skill-evolution">Skill Evolution (`/skill-evolution`)</h2>

Subtitle: *Review AI-suggested skill candidates based on usage patterns.*

| Control | Meaning |
|---------|---------|
| Stats | **Pending / Approved / Rejected** counts, **Avg Confidence** |
| Search | *Search candidates…* |
| Filter **All / Pending / Approved / Rejected** | Status filter |
| **N sessions** | How many sessions the suggestion is based on |
| **Show details / Hide details** | Reasoning + suggested skill content |
| **Approve / Reject** | Human decision; pending only |

Empty: *No skill evolution candidates yet. The system will suggest new skills based on your usage patterns.*

## Related

- [Skills](/docs/en/automation/skills/)
- [Forge](/docs/en/agents/forge/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Proactive](/docs/en/automation/proactive/)
