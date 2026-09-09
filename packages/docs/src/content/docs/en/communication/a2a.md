---
title: A2A & external agents
description: Agent-to-agent protocol — agent card, inbound tasks, optional peer federation.
---

**What this is for.** A2A is how another agent runtime discovers this EYAS and hands it a task — not a person on Telegram, and not a [Hand](/docs/en/admin/hands/) on your desk. EYAS publishes an **Agent Card** at `/.well-known/agent-card.json`. Inbound `tasks/send` creates a conversation and runs the assigned agent. Peer federation (EYAS↔EYAS) exists as an API; there is no dedicated Communication tab for it.

## When to use it

- Another A2A-compatible client should discover this instance and send a task.
- You are exposing EYAS behind [Ingress](/docs/en/admin/ingress/) and need to know the well-known URL and auth scheme.
- You want two EYAS instances to federate (peer registry under `/api/v1/federation/peers`) — operators, not end-user chat.

## Typical workflow

1. Decide the trust boundary. Only enable A2A where network exposure is intentional; put it behind auth/ingress.
2. Confirm the agent card: `GET /.well-known/agent-card.json` (name, version, capabilities, skills, `authentication.schemes` default `bearer`).
3. A peer sends `tasks/send`. EYAS creates a conversation and runs `executeAgent` — it does not instant-fail as unavailable when agents are set up.
4. Optional: register a peer via `POST /api/v1/federation/peers` (`name`, `baseUrl`). Share the inbound token once; rotate with `POST …/rotate-inbound`. Address form: `peerId/agentId`.
5. Watch conversations and the A2A task mailbox for results. Failed or unconfigured execution no longer “instant-fails” when agents are set up correctly.

## Features

| Concept | Meaning |
|---------|---------|
| Agent card | Machine-readable description of capabilities/endpoints at `/.well-known/agent-card.json` |
| Default skills on the card | `research` (Deep Research), `code-review` (Code Review) |
| Trust boundary | Only enable A2A where network exposure is intentional |
| Discovery | Peers fetch the well-known URL |
| Task execution | Inbound `tasks/send` is wired to the real agent runner (`executeAgent`) — creates a conversation, then runs the assigned agent |
| Mailbox | Communication service list/get for A2A task mailbox surfaces |
| Peer registry | Opt-in EYAS↔EYAS federation; messages use `peerId/agentId` |
| Tokens | Inbound token is what peers must present; outbound token is what we present when calling them |

There is **no** Communication UI tab for A2A peers. Channel catalogue explicitly excludes MCP / A2A from chat cards.

## Related

- [Ingress](/docs/en/admin/ingress/)
- [Channels](/docs/en/communication/channels/)
- [Agents overview](/docs/en/agents/overview/)
- [Tools](/docs/en/automation/tools/) (A2A delegate tools)
