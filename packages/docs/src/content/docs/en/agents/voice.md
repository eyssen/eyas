---
title: Voice profiles
description: Internal and external voice — dimensions, presets, blocked phrases, signature.
---

**Route:** `/agents/:id` → tab **Voice**.

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
