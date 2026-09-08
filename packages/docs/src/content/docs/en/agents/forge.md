---
title: Forge
description: Review human-approved proposals to change an agent's soul, skills, or tools.
---

**What this is for.** Forge is the human-in-the-loop path for changing how agents work. The system **proposes** (soul, skill, or tool); you **Approve & apply** or **Reject**. Nothing of identity rewrites itself unless autonomy explicitly allows self-update — the default safe path is a proposal on this page.

## When to use it

- An agent wants to change IDENTITY / soul and must not edit the file itself.
- Feedback on a skill or tool has piled up and you want **Scan Now** to turn it into proposals.
- You need to see current vs proposed value, reasoning, and confidence before applying.
- You want a log of collected feedback (useful / friction) without applying anything yet.

## Typical workflow

1. Open **Forge** in the sidebar (**AI** section) — route `/forge`.
2. Stay on **Proposals** (or switch to **Feedback**). Filter **All / Pending / Testing / Approved / Rejected / Applied**.
3. Expand a card — especially under **Soul proposals**. Read current vs proposed, then **Approve & apply** or **Reject**.
4. The status should move to **Applied** (or **Rejected**). Open the agent's **Workspace** tab to confirm IDENTITY matches the applied text.

## Features

Forge is the **human-in-the-loop** path for changing deep agent identity/soul, skills, and tools. Agents (or the system) **propose**; you **review and apply** — or reject.

## Why Forge exists

| Path | When |
|------|------|
| Direct workspace edit | You edit IDENTITY/SOUL files yourself |
| Agent self-update | Only if autonomy `identitySelfUpdate` allows it |
| **Forge proposal** | Default safe path for autonomous improvement |

When identity self-update is disabled in config/autonomy, agents must use forge proposals instead of rewriting IDENTITY.md directly.

## Page chrome

Subtitle: *Feedback-driven improvement proposals for tools and skills.*

| Control | Meaning |
|---------|---------|
| **Scan Now** | Analyse collected feedback and generate proposals |
| Stats **Total / Pending / Applied** | Counts across soul + tool/skill proposals |
| Tab **Proposals** | Review queue |
| Tab **Feedback** | Raw useful/friction items recorded when tools and skills are used |
| Filter **All** + status chips | Restrict the list |

Empty proposals: *No proposals yet. Click "Scan Now" to analyze feedback and generate improvement proposals.*  
Empty feedback: *No feedback collected yet. Feedback is recorded automatically when tools and skills are used.*

### Proposal statuses

**Pending · Testing · Approved · Rejected · Applied**

### Targets

| Target | Meaning |
|--------|---------|
| **Soul** | Identity / workspace prose — listed under **Soul proposals** |
| **Skill** | Skill text or behaviour |
| **Tool** | Tool description, schema, or code |

Scopes on a proposal: **description · schema · prompt · behavior · code**.

## Soul proposal card

Soul proposals are listed separately from tool/skill cards. They are **human-approved** — applying writes the workspace file.

| Control | Meaning |
|---------|---------|
| **Current value** | What is on disk now |
| **Proposed value** | What would replace it |
| **Reasoning** | Why the change |
| **Based on N feedback items** | Evidence count |
| **Approve & apply** | Accept into workspace |
| **Reject** | Discard |

Tool/skill cards add **Show details / Hide details**, confidence, and **Approve & Apply** / **Reject**.

## Related

- [Identity & workspace](/docs/en/agents/identity-workspace/)
- [Autonomy](/docs/en/agents/autonomy/)
- [Self-learning](/docs/en/automation/self-learning/)
