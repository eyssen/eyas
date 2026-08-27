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

## Brand compliance

When a background run works inside a project that has a brand, and it produces
something a brand applies to — a rendered page, an email draft, a document, a
design canvas — a check reads the result against the brand and hands concrete
deviations back to the agent once. "The heading uses #ff0000; the brand primary
is #1f4ed8" is the kind of note it gives, not "make it nicer".

It runs only after the completeness check has passed. A run that did not finish
its work is not told about its colours.

It is deliberately soft. It never fails a run that could not be checked — no
model available, no brand, nothing brand-shaped in the output — because the work
is already done and a colour is not worth undoing it for. Where the brand is
enforced *hard* is the frame: the email shell, notification templates and the
branded-HTML tool build their chrome from the brand deterministically, and no
agent can talk them out of it.

It shares one hand-back per run lineage with the completeness check, so the two
together can never bounce a run back and forth. Turn it off with
`agent.brandCriticEnabled: false`.
