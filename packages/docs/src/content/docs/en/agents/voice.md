---
title: Voice profiles
description: Set how an agent speaks internally vs externally — six dimensions, presets, AUTO.
---

**What this is for.** Voice is how the agent talks, not what it knows. Every agent has two profiles: **Internal communication** (you and teammates) and **External communication** (clients, strangers, public channels). The runtime picks **AUTO** unless you override the scope on a conversation.

## When to use it

- You want a different tone with the team than with a client.
- You are starting from a preset (Jarvis, Diplomat, Coach, …) and then tweaking one dimension.
- You need blocked phrases (empty apologies) or a closing **Signature**.
- A conversation should force Internal or External regardless of the agent default.

## Typical workflow

1. Open **Agents** → the agent → tab **Voice** — route `/agents/:id`.
2. Choose an **Internal preset** and an **External preset**, or leave **Custom** after editing a field.
3. Adjust the six dimensions on each block, plus **Blocked phrases** and **Signature**. **Save voice profile**.
4. In a conversation, the **Voice · INTERNAL / EXTERNAL / AUTO** badge should match; override there if this thread is an exception.

## Features

Every agent has two speaking styles:

| Profile | Used for |
|---------|----------|
| **Internal communication** | You and teammates |
| **External communication** | Clients, strangers, public channels |

The runtime picks a profile from context (**AUTO**) unless you override it on a conversation ([Voice scope](/docs/en/daily/conversations/)).

---

## Presets

| Control | Meaning |
|---------|---------|
| **Internal preset** | Dropdown of built-in styles for internal voice |
| **External preset** | Same for external |
| **Custom** | Automatic when you edit individual fields |

### Built-in presets

| Preset | Character |
|--------|-----------|
| **Jarvis** | Formal, concise, professional |
| **Best buddy** | Friendly, balanced |
| **Senior CEO** | Serious, very direct |
| **Buddy Dev** | Casual, developer style |
| **Standup** | Playful, provocative |
| **Diplomat** | Formal, detailed |
| **Coach** | Direct, motivating |
| **Tutor** | Friendly, detailed |

Selecting a preset fills the six dimensions below.

---

## Dimensions

| Dimension | Options |
|-----------|---------|
| **Address** | Informal (te) · Formal (maga) · Formal (ön) · Context-sensitive |
| **Tone** | Serious · Balanced · Friendly · Casual · Playful |
| **Verbosity** | Concise · Balanced · Detailed |
| **Directness** | Very direct · Direct + polite · Diplomatic · Indirect |
| **Humor** | None · Dry/witty · Light · Sharp/provocative |
| **Emoji** | Never · Functional · Often |

Each dimension is set **twice** (internal block + external block).

---

## Extra fields

| Field | Meaning |
|-------|---------|
| **Blocked phrases (one per line)** | Phrases the agent must not use (e.g. empty apologies) |
| **Signature** | Closing signature line (e.g. `— EYAS, your assistant`) |

## Actions

| Control | Meaning |
|---------|---------|
| **Save voice profile** | Persist both profiles + extras |

## Related

- [Create & configure](/docs/en/agents/configure/)
- [Conversations — voice scope](/docs/en/daily/conversations/)
