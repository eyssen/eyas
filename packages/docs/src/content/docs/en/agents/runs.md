---
title: Runs & Mission Control
description: Agent runs list, progress, Mission Control cards and actions.
---

## Agent Runs

**Route:** `/agent-runs`. Historical and live executions of agents (turns, tokens, status).

Typical columns/states (product UI):

| Element | Meaning |
|---------|---------|
| Run id / time | When the run started |
| Agent | Which agent executed |
| Status | running / completed / failed / cancelled / waiting_approval / paused |
| Tokens / cost | Usage for the run |
| Link to conversation | Open the parent thread |

## Mission Control

**Route:** `/mission-control`. Operational board of **live** agents.

| Element | Meaning |
|---------|---------|
| Agent card | One agent’s live state |
| Status | Running, Waiting for approval, Paused, Idle, Error, … |
| Actions | Stop / resume / open conversation (as offered by the card actions) |

Use Mission Control when you need an at-a-glance ops view; use Agent Runs for history.

## Inside a conversation

While a run is active you also see:

- Agent progress (turn N/max, tokens, Cancel)  
- Run tree / workflow  
- Tool call expanders  

Documented under [Conversations](/docs/en/daily/conversations/).

## Related

- [Conversations](/docs/en/daily/conversations/)
- [Home — Now running](/docs/en/daily/home/)
- [Autonomy](/docs/en/agents/autonomy/)
