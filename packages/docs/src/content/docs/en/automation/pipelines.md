---
title: Pipelines
description: Multi-step flows such as ticket-to-code.
---

**Route:** `/pipelines`.

Pipelines are **orchestrated multi-step jobs** (e.g. ticket → analysis → code changes) with inputs, gates, and run history.

| Concept | Meaning |
|---------|---------|
| Pipeline definition | Named flow template |
| Run | One execution instance |
| Input | Ticket id, repo, options |
| Gate / approval | Human checkpoint mid-flow |
| Artifact | Output of a stage |

Open a run for step-level status. Ticket-to-code UI may appear as a specialised pipeline page.

## Related

- [Agents / runs](/docs/en/agents/runs/)
- [Projects](/docs/en/daily/projects/)
