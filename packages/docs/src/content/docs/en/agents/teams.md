---
title: Teams & delegation
description: Team builder, phases, handoffs, and multi-agent collaboration.
---

Agents collaborate through **delegation**, **team sessions** in conversations, and optional **team configuration** UI.

## Concepts

| Concept | Meaning |
|---------|---------|
| **Primary** | Orchestrates day-to-day work; can delegate |
| **Team / specialist** | Receives delegated tasks in their domain |
| **Handoff** | Passing work (often with artifacts) to another agent |
| **Team session** | Multi-agent run visible as sub-conversations |
| **Team proposal** | Plan the user must approve before fan-out |

## Team Builder (agent UI)

| Control | Meaning |
|---------|---------|
| **Team Builder** | Configure multi-phase team plans |
| **N phases** | Number of orchestration phases |
| **Est. ~N tokens** | Rough token estimate for the plan |

Phase modes (also on team proposals in chat):

| Mode | Meaning |
|------|---------|
| **parallel** | Agents in the phase run concurrently |
| **sequential** | Ordered steps |

## In conversations

See [Conversations — Team features](/docs/en/daily/conversations/):

- Sub-conversation tree  
- Team Dashboard (findings, decisions, blockers)  
- Team proposal **Approve / Skip / Create missing specialists**  

## Setup path

Optional **Team agents** step in the [setup wizard](/docs/en/setup-wizard/) selects specialist templates. Change later under Agents / Settings.

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Runs & Mission Control](/docs/en/agents/runs/)
- [Agents overview](/docs/en/agents/overview/)
