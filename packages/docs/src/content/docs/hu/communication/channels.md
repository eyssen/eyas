---
title: Csatornák áttekintés
description: Példányok, módok, ágens kötés, inbound, pairing.
---

**Útvonal:** `/communication` — **Channels · Inbound Queue · Pairing**.

Több példány ugyanabból a típusból lehetséges (**Add instance**).

## Státuszok

Connected, Disconnected, Credentials set, Not configured, Error; health Conflict/Auth error/Degraded.

## Mód

**Autonomous** vs **Managed** (security gate).

## Mezők

Csatorna-specifikus secrettek, **Agent for inbound messages**, Save & connect, Test/Connect/Disconnect.

Pairing tab: pairing kód jóváhagyás (Telegram DM előtt kötelező).
