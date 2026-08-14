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

## Related

- [Tools](/docs/en/automation/tools/)
- [Self-learning & skill evolution](/docs/en/automation/self-learning/)
