---
title: Skills
description: Skill catalogue — sources, filters, create form fields.
---

**Route:** `/skills`. Subtitle: *Manage skill templates, trigger patterns, and generated skills.*

## List chrome

| Control | Meaning |
|---------|---------|
| **enabled** | How many skills are enabled |
| **Create Skill** | Open create form |
| Search | *Search by name or trigger pattern…* |
| Filter **All / Own skills / Bundled** | Source filter |

## Sources / categories

| Label | Meaning |
|-------|---------|
| **Bundled** | Shipped with EYAS |
| **User** | Created by you in the UI |
| **Generated** | Produced by skill generation / evolution |
| **Own** | Imported or EYAS-suggested “own” category |

## Create form

| Field | Meaning |
|-------|---------|
| **Skill name** | Display name |
| **Trigger patterns (comma separated)** | When the skill is considered for activation |
| **Skill content / template** | Markdown body the agent loads |

## Row actions

| Control | Meaning |
|---------|---------|
| **Show content / Hide content** | Expand markdown body |

Empty: *No skills found. Create one to get started.*

---

## Bundled coding skills (examples)

| Path / area | Purpose |
|-------------|---------|
| `coding/odoo/odoo-dev-chain` | Odoo implement/review chain: ground with `odoo_search_*` + file tools before writing modules |

Skills load as markdown procedures; tools still come from the agent’s tool list ([Configure](/docs/en/agents/configure/), [Tools](/docs/en/automation/tools/)).

## Auto-adoption gate (skill curator)

Generated / evolved skills are **not auto-adopted** unless a recent private benchmark snapshot meets minimum **pass ratio** and **average score** thresholds. This keeps low-quality skill proposals out of the live catalogue until eval quality is good enough.

Manual create/enable in the UI is unaffected — the gate applies to the automatic adoption path from skill generation.

## Skill inventory & dead-skill detector

The **Inventory** tab (next to Browse) is a resolution table: one row per skill id, showing which copy won, what it shadows, where it came from, how often it's been used, and whether it's enabled.

### Precedence

When the same skill id exists in more than one place, one copy wins by a fixed, deterministic order — never by filesystem order:

**User > Generated > Bundled by an installed extension > Bundled with EYAS itself**

Ties within the same rank break alphabetically: first by source root, then by file path — the earlier one wins. The losers aren't dropped; they're recorded and shown in the **Shadowed** column.

### The detector proposes, it never acts

A background scan classifies every enabled skill, and for the ones it flags, it files a proposal in the [autonomy approval queue](/docs/en/agents/autonomy/) — it does not touch anything on its own. **It disables skills; it never deletes them.** Nothing changes until you approve the proposal, and approving only flips the skill off (the same switch as in this table) — the file and its history stay put.

| Classification | Why it's flagged | Basis |
|---|---|---|
| **Orphan** | its source file no longer exists | fact |
| **Shadowed** | another source always wins this id | fact |
| **Never used** | zero uses, and older than 90 days | inference |
| **Dormant** | used before, but idle 180+ days | inference |

(Defaults — configurable per instance.)

Orphan and shadowed are facts, not guesses, so they're proposed as soon as they're detected. Never-used and dormant are inferences about intent, so they're held back: a skill younger than 30 days is never proposed on these grounds, and skills you wrote yourself — plus skills marked situational, like disaster-recovery or migration runbooks meant to sleep for months — are exempt from both time-based checks entirely.

This is the other end of the lifecycle from the **Auto-adoption gate** above: that gate decides what's allowed in, this one decides what gets proposed to leave.

## Related

- [Tools](/docs/en/automation/tools/)
- [Self-learning & skill evolution](/docs/en/automation/self-learning/)
- [Autonomy](/docs/en/agents/autonomy/)
