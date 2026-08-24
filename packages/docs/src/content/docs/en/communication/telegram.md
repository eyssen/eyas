---
title: Telegram
description: BotFather token, agent binding, pairing steps.
---

## Setup steps (in product)

1. Open Telegram → **@BotFather**
2. `/newbot` — display name + username ending in `bot`
3. Copy the HTTP API token (`123456:ABC-…`)
4. In EYAS Communication: paste token, choose agent, **Save & connect**
5. Message the bot → approve pairing under **Communication → Pairing**

## Fields

| Field | Meaning |
|-------|---------|
| **Bot token from @BotFather** | Telegram bot API token (stored encrypted) |
| Placeholder | Example token shape |
| Hint | Where to get the token in BotFather |
| **Agent for inbound messages** | Agent that answers DMs/groups as configured |

## Notes

- Pairing-enabled: DMs need an **approved pairing** request first.
- Multiple bots = multiple instances (see [Channels overview](/docs/en/communication/channels/)).

## Related

- [Channels overview](/docs/en/communication/channels/)
- [Pairing tab](/docs/en/communication/channels/)
